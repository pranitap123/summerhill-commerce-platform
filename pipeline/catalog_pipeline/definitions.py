"""Dagster definitions (G3-12): the ingest jobs and their schedules (CATALOG §2).

  cd pipeline && dagster dev        → http://localhost:3000 (or --port 3070 next to the web app)

- catalog_delta: every 15 min during store hours (07:00–21:45 ET): prices, promotions, availability
- catalog_full:  nightly at 03:00 ET: all fields; deactivates products missing from the feed

Each job ingests into Postgres, then syncs the changed products into Elasticsearch (`sync_search`).
The web app's worker also updates Elasticsearch from the outbox and rebuilds the index nightly
(ADR-0007, ADR-0008); both writes are idempotent upserts, so they agree.
"""

import os
from datetime import datetime, timedelta, timezone

from dagster import (
    Definitions,
    Failure,
    OpExecutionContext,
    RunRequest,
    ScheduleDefinition,
    SensorEvaluationContext,
    SkipReason,
    job,
    op,
    sensor,
)

from .connectors import get_connector
from .ingest import run_ingest
from .requests import pending_count, process_requests
from .search_sync import sync_search
from .settings import settings

TIMEZONE = "America/Toronto"


def _ingest(context: OpExecutionContext, mode: str) -> dict:
    s = settings()
    if not s.database_url:
        raise Failure("INGEST_DATABASE_URL is not set")
    started = datetime.now(timezone.utc) - timedelta(minutes=1)
    result = run_ingest(s.database_url, get_connector(s.connector, os.environ), s.merchant_slug, s.location_slug, mode)
    context.log.info(f"ingest run {result.run_id}: {result.summary()}")
    if result.status == "failed":
        raise Failure(f"ingest run {result.run_id} failed: {result.error}")
    if result.status == "held":
        context.log.warning(
            f"ingest run {result.run_id} HELD for approval: {result.anomalies}. "
            f"Approve with `python -m catalog_pipeline approve {result.run_id} --by <name>`"
        )
    return {**result.summary(), "started_at": started.isoformat()}


@op
def sync_search_index(context: OpExecutionContext, ingest: dict) -> dict:
    """Upserts what the ingest run changed into Elasticsearch (skipped when the run was held)."""
    s = settings()
    if ingest.get("status") == "held":
        context.log.warning("ingest was held for approval; search not synced")
        return {"status": "skipped", "reason": "ingest held"}
    since = datetime.fromisoformat(ingest["started_at"]) if ingest.get("started_at") else None
    result = sync_search(s.database_url, s.elasticsearch_url, s.search_alias, since)
    context.log.info(f"search sync: {result}")
    return result


@op
def ingest_delta(context: OpExecutionContext) -> dict:
    return _ingest(context, "delta")


@op
def ingest_full(context: OpExecutionContext) -> dict:
    return _ingest(context, "full")


@job(description="Delta sync: prices, promotions and availability")
def catalog_delta():
    sync_search_index(ingest_delta())


@job(description="Full sync: all fields; deactivates products missing from the feed")
def catalog_full():
    sync_search_index(ingest_full())


delta_schedule = ScheduleDefinition(
    name="catalog_delta_store_hours",
    job=catalog_delta,
    cron_schedule="*/15 7-21 * * *",
    execution_timezone=TIMEZONE,
)
full_schedule = ScheduleDefinition(
    name="catalog_full_nightly",
    job=catalog_full,
    cron_schedule="0 3 * * *",
    execution_timezone=TIMEZONE,
)

@op
def process_admin_requests(context: OpExecutionContext) -> list:
    s = settings()
    if not s.database_url:
        raise Failure("INGEST_DATABASE_URL is not set")
    done = process_requests(s.database_url, s.connector, os.environ)
    for d in done:
        context.log.info(f"ingest request {d['request']}: {d['status']}")
    return done


@job(description="Approvals and re-runs requested in /ops (G5-14)")
def catalog_admin_requests():
    process_admin_requests()


@sensor(job=catalog_admin_requests, minimum_interval_seconds=30)
def admin_requests_sensor(context: SensorEvaluationContext):
    s = settings()
    if not s.database_url:
        return SkipReason("INGEST_DATABASE_URL is not set")
    n = pending_count(s.database_url)
    if not n:
        return SkipReason("no pending requests")
    return RunRequest(run_key=None, tags={"pending": str(n)})


defs = Definitions(
    jobs=[catalog_delta, catalog_full, catalog_admin_requests],
    schedules=[delta_schedule, full_schedule],
    sensors=[admin_requests_sensor],
)
