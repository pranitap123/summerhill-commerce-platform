"""Elasticsearch sync after ingest (Stage 2): the document shape, and the bulk calls it makes."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from catalog_pipeline.connectors.fixture import FixtureConnector
from catalog_pipeline.ingest import run_ingest
from catalog_pipeline.search_sync import effective_price, sync_search, to_document

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)

MAPPING_FIELDS = {
    "id", "slug", "merchantId", "merchantSlug", "name", "brand", "description", "category",
    "categorySlug", "subcategory", "subcategorySlug", "organic", "dietaryClaims", "pricingModel",
    "unit", "effectivePriceCents", "onSale", "taxCode", "inStock", "listed", "hiddenUntil",
    "image", "updatedAt",
}


def promo(cents, starts=None, ends=None):
    return {"sale_price_cents": cents, "starts_at": starts, "ends_at": ends}


def test_effective_price_is_the_lowest_active_promotion():
    day = timedelta(days=1)
    assert effective_price(500, [], NOW) == 500
    assert effective_price(500, [promo(400), promo(350)], NOW) == 350
    assert effective_price(500, [promo(300, starts=(NOW + day).isoformat())], NOW) == 500
    assert effective_price(500, [promo(300, ends=(NOW - day).isoformat())], NOW) == 500
    assert effective_price(500, [promo(600)], NOW) == 500


class FakeEs:
    """Just the three calls the sync makes: HEAD alias, POST _bulk, POST _refresh."""

    def __init__(self, alias_exists=True):
        self.alias_exists = alias_exists
        self.bulks = []
        self.refreshed = 0

    def head(self, url, timeout=None):
        return type("R", (), {"status_code": 200 if self.alias_exists else 404})()

    def post(self, url, data=None, headers=None, timeout=None):
        if url.endswith("/_refresh"):
            self.refreshed += 1
            return type("R", (), {"status_code": 200})()
        self.bulks.append([json.loads(line) for line in data.decode().strip().split("\n")])
        res = type("R", (), {"raise_for_status": lambda self: None, "json": lambda self: {"errors": False, "items": []}})()
        return res


def test_skips_when_there_is_no_index():
    es = FakeEs(alias_exists=False)
    out = sync_search("postgres://unused", session=es)
    assert out["status"] == "skipped" and "search:rebuild" in out["reason"] and es.bulks == []


@pytest.mark.db
def test_upserts_every_product_with_the_index_fields_and_no_popularity(db):
    feed = FixtureConnector().load()["products"]
    run_ingest(db.ingest_url, FixtureConnector(), "demo-market", "downtown", "full")
    es = FakeEs()
    out = sync_search(db.ingest_url, "http://es.test", "catalog-products", session=es)
    assert out == {"status": "synced", "alias": "catalog-products", "upserted": len(feed), "deleted": 0}
    lines = [line for bulk in es.bulks for line in bulk]
    actions, docs = lines[0::2], lines[1::2]
    assert len(docs) == len(feed) and all("update" in a for a in actions)
    assert all(d["doc_as_upsert"] is True and set(d["doc"]) == MAPPING_FIELDS for d in docs)
    sample = next(d["doc"] for d in docs if d["doc"]["id"] == "DEMO-0001")
    assert sample["name"] and sample["effectivePriceCents"] > 0 and sample["inStock"] in (True, False)
    assert es.refreshed == 1


@pytest.mark.db
def test_since_limits_the_sync_to_what_changed(db):
    run_ingest(db.ingest_url, FixtureConnector(), "demo-market", "downtown", "full")
    es = FakeEs()
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    out = sync_search(db.ingest_url, since=future, session=es)
    assert out["upserted"] == 0 and es.bulks == [] and es.refreshed == 0
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    assert sync_search(db.ingest_url, since=past, session=FakeEs())["upserted"] > 0


@pytest.mark.db
def test_removes_deleted_products(db):
    run_ingest(db.ingest_url, FixtureConnector(), "demo-market", "downtown", "full")
    db.sql("UPDATE catalog.products SET deleted_at = now(), updated_at = now() WHERE id = 'DEMO-0001'")
    es = FakeEs()
    out = sync_search(db.ingest_url, session=es)
    assert out["deleted"] == 1
    assert {"delete": {"_id": "DEMO-0001"}} in [line for bulk in es.bulks for line in bulk]
    assert all(d.get("update", {}).get("_id") != "DEMO-0001" for bulk in es.bulks for d in bulk)
