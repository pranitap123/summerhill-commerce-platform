"""Catalogue admin requests (G5-14): /ops asks, the pipeline carries it out as ingest_rw."""
import pytest

from catalog_pipeline.connectors import get_connector
from catalog_pipeline.connectors.fixture import FixtureConnector
from catalog_pipeline.ingest import run_ingest
from catalog_pipeline.requests import pending_count, process_requests

pytestmark = pytest.mark.db
FEED = FixtureConnector().load()["products"]


def request(db, kind, run_id=None, mode=None):
    """Inserted as app_rw, like the web app does."""
    return db.sql(
        """INSERT INTO ops.ingest_requests (merchant_id, kind, run_id, mode, requested_by)
           SELECT id, %s, %s, %s, 'admin@example.com' FROM merchant.merchants WHERE slug = 'demo-market'
           RETURNING id""",
        (kind, run_id, mode),
        url=db.app_url,
    )[0][0]


def test_held_run_is_approved_through_a_request(db):
    run_ingest(db.ingest_url, FixtureConnector(), "demo-market", "downtown", "full")
    half = get_connector("fixture", {"CATALOG_FIXTURE_FRACTION": "0.5"})
    held = run_ingest(db.ingest_url, half, "demo-market", "downtown", "full")
    assert held.status == "held"
    req = request(db, "approve", run_id=held.run_id)
    assert pending_count(db.ingest_url) == 1

    done = process_requests(db.ingest_url, "fixture", {"CATALOG_FIXTURE_FRACTION": "0.5"})
    assert [d["status"] for d in done] == ["done"]
    assert db.sql("SELECT status, approved_by FROM ops.ingest_runs WHERE id = %s", (held.run_id,))[0] == (
        "approved",
        "admin@example.com",
    )
    assert db.sql("SELECT status FROM ops.ingest_requests WHERE id = %s", (req,))[0][0] == "done"
    assert db.sql("SELECT count(*) FROM catalog.products WHERE deleted_at IS NULL")[0][0] == len(FEED) // 2
    assert pending_count(db.ingest_url) == 0


def test_rerun_request_runs_an_ingest(db):
    req = request(db, "run", mode="full")
    done = process_requests(db.ingest_url, "fixture", {})
    assert done[0]["status"] == "done" and done[0]["run"]["inserted"] == len(FEED)
    assert db.sql("SELECT status, result->>'status' FROM ops.ingest_requests WHERE id = %s", (req,))[0] == (
        "done",
        "applied",
    )


def test_a_failed_request_records_the_error(db):
    run = run_ingest(db.ingest_url, FixtureConnector(), "demo-market", "downtown", "full")
    req = request(db, "approve", run_id=run.run_id)
    done = process_requests(db.ingest_url, "fixture", {})
    assert done[0]["status"] == "failed"
    row = db.sql("SELECT status, error FROM ops.ingest_requests WHERE id = %s", (req,))[0]
    assert row[0] == "failed" and "not held" in row[1]
