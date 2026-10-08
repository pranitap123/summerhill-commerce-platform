"""Requests from the web app's catalogue admin (G5-14, A3): approve a held run, or run an ingest.

The web app can't write the catalogue (ADR-0004), so /ops records a row in ops.ingest_requests and
the pipeline carries it out as ingest_rw: from the Dagster sensor every 30 s, or with
`python -m catalog_pipeline process-requests`. Each request is claimed with SKIP LOCKED, so two
processors never take the same one.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from typing import Any

from .connectors import get_connector
from .ingest import approve_run, connect, run_ingest

log = logging.getLogger(__name__)


def _claim(conninfo: str) -> dict[str, Any] | None:
    with connect(conninfo) as conn:
        return conn.execute(
            """UPDATE ops.ingest_requests SET processed_at = now()
               WHERE id = (SELECT id FROM ops.ingest_requests
                           WHERE status = 'pending' AND processed_at IS NULL
                           ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
               RETURNING id, merchant_id, kind, run_id, mode, requested_by"""
        ).fetchone()


def _finish(conninfo: str, request_id: int, status: str, result: dict | None, error: str | None) -> None:
    with connect(conninfo) as conn:
        conn.execute(
            "UPDATE ops.ingest_requests SET status = %s, result = %s, error = %s, processed_at = now() WHERE id = %s",
            (status, json.dumps(result) if result is not None else None, error, request_id),
        )


def _slugs(conninfo: str, merchant_id: int) -> tuple[str, str]:
    with connect(conninfo) as conn:
        row = conn.execute(
            """SELECT m.slug AS merchant, l.slug AS location FROM merchant.merchants m
               JOIN merchant.locations l ON l.merchant_id = m.id WHERE m.id = %s ORDER BY l.id LIMIT 1""",
            (merchant_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"merchant {merchant_id} has no location")
    return row["merchant"], row["location"]


def process_requests(conninfo: str, connector_name: str, env: Mapping[str, str], limit: int = 10) -> list[dict]:
    """Processes up to `limit` pending requests; returns what happened to each."""
    done: list[dict] = []
    for _ in range(limit):
        req = _claim(conninfo)
        if not req:
            break
        try:
            connector = get_connector(connector_name, env)
            if req["kind"] == "approve":
                result = approve_run(conninfo, req["run_id"], req["requested_by"], connector)
            else:
                merchant, location = _slugs(conninfo, req["merchant_id"])
                result = run_ingest(conninfo, connector, merchant, location, req["mode"])
            summary = result.summary()
            status = "failed" if result.status == "failed" else "done"
            _finish(conninfo, req["id"], status, summary, result.error if status == "failed" else None)
            done.append({"request": req["id"], "status": status, "run": summary})
        except Exception as exc:
            log.exception("ingest request %s failed", req["id"])
            _finish(conninfo, req["id"], "failed", None, f"{type(exc).__name__}: {exc}")
            done.append({"request": req["id"], "status": "failed", "error": str(exc)})
    return done


def pending_count(conninfo: str) -> int:
    with connect(conninfo) as conn:
        return conn.execute(
            "SELECT count(*) AS n FROM ops.ingest_requests WHERE status = 'pending' AND processed_at IS NULL"
        ).fetchone()["n"]
