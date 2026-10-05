"""End-to-end ingest against real Postgres (G3-02, G3-05, G3-06, G3-07, G3-11, G3-14), as ingest_rw."""
import copy

import psycopg
import pytest

from catalog_pipeline.connectors.fixture import FixtureConnector
from catalog_pipeline.ingest import approve_run, reject_run, run_ingest

pytestmark = pytest.mark.db
FEED = FixtureConnector().load()["products"]


def feed(records=None):
    return FixtureConnector(records=copy.deepcopy(records if records is not None else FEED))


def ingest(db, records=None, mode="full", **kw):
    return run_ingest(db.ingest_url, feed(records), "demo-market", "downtown", mode, **kw)


def product_state(db):
    return {r[0]: r[1:] for r in db.sql("SELECT id, xmin::text, updated_at, source_hash FROM catalog.products")}


def test_first_run_loads_every_fixture_row(db):
    r = ingest(db)
    assert (r.status, r.fetched, r.inserted, r.quarantined) == ("applied", len(FEED), len(FEED), 0)
    assert db.sql("SELECT count(*) FROM catalog.products")[0][0] == len(FEED)
    ids = {row[0] for row in db.sql("SELECT external_id FROM catalog.products")}
    assert ids == {p["external_id"] for p in FEED}
    promos = sum(1 for p in FEED if p["promotion"])
    assert db.sql("SELECT count(*) FROM catalog.promotions")[0][0] == promos
    # every product announced to search/storefront, plus one run event
    topics = dict(db.sql("SELECT topic, count(*) FROM ops.outbox GROUP BY topic"))
    assert topics == {"product.changed": len(FEED), "catalog.ingested": 1}
    # the canonical fields arrived
    row = db.sql(
        """SELECT v.slug, v.brand, v.organic, v.dietary_claims, v.source_type, p.source_hash, v.is_visible
           FROM catalog.product_view v JOIN catalog.products p USING (id) WHERE v.id = 'DEMO-0001'"""
    )[0]
    assert row[0].startswith("lakeside-farms-honeycrisp-apples-") and row[1] == "Lakeside Farms"
    assert row[4] == "Produce" and len(row[5]) == 64 and row[6] is True


def test_rerun_writes_nothing(db):
    ingest(db)
    before = product_state(db)
    outbox = db.sql("SELECT count(*) FROM ops.outbox")[0][0]
    r = ingest(db)
    assert (r.inserted, r.updated, r.unchanged, r.deactivated) == (0, 0, len(FEED), 0)
    assert product_state(db) == before  # xmin unchanged → no row was rewritten
    assert db.sql("SELECT count(*) FROM ops.outbox")[0][0] == outbox


def test_price_change_updates_one_product_and_emits_one_event(db):
    ingest(db)
    changed = copy.deepcopy(FEED)
    changed[5]["unit_price_cents"] += 100
    last = db.sql("SELECT max(id) FROM ops.outbox")[0][0]
    r = ingest(db, changed)
    assert (r.updated, r.unchanged) == (1, len(FEED) - 1)
    new = db.sql("SELECT key FROM ops.outbox WHERE topic = 'product.changed' AND id > %s ORDER BY id", (last,))
    assert [k for (k,) in new] == [changed[5]["external_id"]]


def test_half_feed_is_held_and_catalogue_untouched_until_approved(db):
    ingest(db)
    before = product_state(db)
    r = ingest(db, FEED[: len(FEED) // 2])
    assert r.status == "held"
    assert {a["check"] for a in r.anomalies} >= {"fetched_drop", "mass_deactivation"}
    assert product_state(db) == before
    run = db.sql("SELECT status, staged IS NOT NULL FROM ops.ingest_runs WHERE id = %s", (r.run_id,))[0]
    assert run == ("held", True)

    approved = approve_run(db.ingest_url, r.run_id, "admin@example.com", feed())
    assert approved.status == "approved" and approved.deactivated == len(FEED) - len(FEED) // 2
    run = db.sql("SELECT status, approved_by, staged FROM ops.ingest_runs WHERE id = %s", (r.run_id,))[0]
    assert run == ("approved", "admin@example.com", None)
    assert db.sql("SELECT count(*) FROM catalog.products WHERE deleted_at IS NULL")[0][0] == len(FEED) // 2


def test_rejected_run_changes_nothing(db):
    ingest(db)
    r = ingest(db, FEED[:10])
    reject_run(db.ingest_url, r.run_id, "admin@example.com")
    assert db.sql("SELECT status FROM ops.ingest_runs WHERE id = %s", (r.run_id,))[0][0] == "rejected"
    assert db.sql("SELECT count(*) FROM catalog.products WHERE deleted_at IS NULL")[0][0] == len(FEED)


def test_bad_rows_are_quarantined_and_good_rows_load(db):
    records = copy.deepcopy(FEED)
    records[0]["unit_price_cents"] = 0
    records[1]["name"] = ""
    records.append({**records[2]})  # duplicate external_id
    r = ingest(db, records)
    assert r.status == "applied" and r.quarantined == 3 and r.inserted == len(FEED) - 2
    reasons = sorted(q for (q,) in db.sql("SELECT reason FROM ops.ingest_quarantine"))
    assert reasons == ["duplicate external_id in feed", "missing name", "price must be greater than 0"]


def test_poisoned_feed_is_held(db):
    ingest(db)
    records = copy.deepcopy(FEED)
    for p in records[:40]:
        p["unit_price_cents"] = -1
    r = ingest(db, records)
    assert r.status == "held" and {a["check"] for a in r.anomalies} >= {"quarantine_rate"}


def test_mass_price_change_is_held(db):
    ingest(db)
    records = copy.deepcopy(FEED)
    for p in records[: len(records) // 3]:
        p["unit_price_cents"] += 50
        if p.get("promotion"):
            p["promotion"] = None
    r = ingest(db, records)
    assert r.status == "held" and [a["check"] for a in r.anomalies] == ["mass_price_change"]


def test_full_run_soft_deletes_missing_products_and_delta_does_not(db):
    ingest(db)
    missing = FEED[0]["external_id"]
    r = ingest(db, FEED[1:], mode="delta")
    assert r.deactivated == 0
    r = ingest(db, FEED[1:])
    assert r.deactivated == 1
    assert db.sql("SELECT deleted_at IS NOT NULL, is_visible FROM catalog.product_view WHERE id = %s", (missing,))[0] == (True, False)
    # reappearing undeletes it
    r = ingest(db)
    assert r.updated == 1
    assert db.sql("SELECT deleted_at FROM catalog.products WHERE id = %s", (missing,))[0][0] is None


def test_unknown_category_goes_to_uncategorised_and_is_flagged(db):
    records = copy.deepcopy(FEED)
    records[0]["category"], records[0]["subcategory"] = "Pet Supplies", "Dog Food"
    r = ingest(db, records)
    assert {"rule": "category_unmapped", "source_type": "Pet Supplies", "source_subtype": "Dog Food"} in r.flags
    row = db.sql("SELECT category, subcategory FROM catalog.product_view WHERE id = %s", (records[0]["external_id"],))
    assert row == [("Uncategorised", "Uncategorised")]
    mapping = db.sql(
        "SELECT status, subcategory_id FROM catalog.category_mappings WHERE source_type = 'Pet Supplies'"
    )
    assert mapping == [("unmapped", None)]
    # every fixture category is mapped: nothing else went to Uncategorised
    assert db.sql("SELECT count(*) FROM catalog.product_view WHERE category = 'Uncategorised'")[0][0] == 1


def test_admin_remap_moves_products_on_next_run(db):
    records = copy.deepcopy(FEED)
    records[0]["category"], records[0]["subcategory"] = "Pet Supplies", ""
    ingest(db, records)
    db.sql(
        """UPDATE catalog.category_mappings SET status = 'mapped', subcategory_id = (
             SELECT s.id FROM catalog.subcategories s JOIN catalog.categories c ON c.id = s.category_id
             WHERE c.name = 'Miscellaneous' AND s.name = 'General')
           WHERE source_type = 'Pet Supplies'""",
        url=db.app_url,
    )
    r = ingest(db, records)
    assert r.updated == 1
    assert db.sql("SELECT category FROM catalog.product_view WHERE id = %s", (records[0]["external_id"],)) == [("Miscellaneous",)]


def test_overrides_survive_reingest(db):
    ingest(db)
    pid = FEED[0]["external_id"]
    db.sql(
        """INSERT INTO catalog.product_overrides (product_id, name, hidden, updated_by)
           VALUES (%s, 'Staff-Picked Apples', false, 'admin@example.com')""",
        (pid,),
        url=db.app_url,
    )
    records = copy.deepcopy(FEED)
    records[0]["name"] = "Renamed Upstream Apples"
    records[0]["unit_price_cents"] += 10
    r = ingest(db, records)
    assert r.updated == 1
    row = db.sql("SELECT name, source_name FROM catalog.product_view WHERE id = %s", (pid,))[0]
    assert row == ("Staff-Picked Apples", "Renamed Upstream Apples")
    assert db.sql("SELECT count(*) FROM catalog.product_overrides")[0][0] == 1


def test_hidden_until_override_hides_until_the_time_passes(db):
    ingest(db)
    pid = FEED[0]["external_id"]
    db.sql(
        """INSERT INTO catalog.product_overrides (product_id, hidden_until, updated_by)
           VALUES (%s, now() + interval '1 hour', 'console')""",
        (pid,),
        url=db.app_url,
    )
    assert db.sql("SELECT is_visible FROM catalog.product_view WHERE id = %s", (pid,))[0][0] is False
    db.sql("UPDATE catalog.product_overrides SET hidden_until = now() - interval '1 minute'", url=db.app_url)
    assert db.sql("SELECT is_visible FROM catalog.product_view WHERE id = %s", (pid,))[0][0] is True


def test_ingest_role_cannot_write_overrides(db):
    ingest(db)
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.sql(
            "INSERT INTO catalog.product_overrides (product_id, hidden, updated_by) VALUES (%s, true, 'x')",
            (FEED[0]["external_id"],),
            url=db.ingest_url,
        )


def test_rename_keeps_old_slug_for_redirects(db):
    ingest(db)
    pid = FEED[0]["external_id"]
    old = db.sql("SELECT slug FROM catalog.products WHERE id = %s", (pid,))[0][0]
    records = copy.deepcopy(FEED)
    records[0]["name"] = "Crisp Apples"
    ingest(db, records)
    new = db.sql("SELECT slug FROM catalog.products WHERE id = %s", (pid,))[0][0]
    assert new.startswith("crisp-apples-") and new != old
    assert db.sql("SELECT product_id FROM catalog.product_slug_history WHERE slug = %s", (old,)) == [(pid,)]


def test_promotions_end_when_absent_and_effective_data_is_consistent(db):
    ingest(db)
    promo = next(p for p in FEED if p["promotion"])
    records = copy.deepcopy(FEED)
    next(p for p in records if p["external_id"] == promo["external_id"])["promotion"] = None
    r = ingest(db, records)
    assert r.updated == 1
    assert db.sql("SELECT count(*) FROM catalog.promotions WHERE product_id = %s", (promo["external_id"],))[0][0] == 0


def test_alcohol_is_ingested_but_blocked(db):
    records = copy.deepcopy(FEED)
    records[0]["is_alcohol"] = True
    ingest(db, records)
    assert db.sql("SELECT blocked_reason, is_visible FROM catalog.product_view WHERE id = %s", (records[0]["external_id"],))[0] == (
        "alcohol_not_licensed",
        False,
    )


def test_failed_run_is_recorded(db):
    class Broken(FixtureConnector):
        def extract(self, mode):
            raise ConnectionError("upstream down")

    r = run_ingest(db.ingest_url, Broken(), "demo-market", "downtown")
    assert r.status == "failed"
    assert db.sql("SELECT status, error FROM ops.ingest_runs WHERE id = %s", (r.run_id,))[0] == (
        "failed",
        "ConnectionError: upstream down",
    )
    assert db.sql("SELECT count(*) FROM catalog.products")[0][0] == 0
