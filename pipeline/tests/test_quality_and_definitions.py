from catalog_pipeline.canonical import CanonicalProduct
from catalog_pipeline.quality import Plan, anomalies, blocked_reason, row_flags
from catalog_pipeline.taxonomy import UNCATEGORISED, identity_mappings, taxonomy_rows, type_level_mappings


def p(**kw):
    return CanonicalProduct(**{**dict(external_id="X", name="N", source_type="T", source_subtype="S",
                                     unit_price_cents=1000, images=["/x.jpg"]), **kw})


def test_healthy_run_has_no_anomalies():
    plan = Plan(fetched=200, valid=200, quarantined=0, updates=10, unchanged=190, price_changes=10, active_before=200)
    assert anomalies(plan, last_fetched=200, mode="full") == []


def test_half_feed_is_held():
    plan = Plan(fetched=100, valid=100, quarantined=0, unchanged=100, deactivations=100, active_before=200)
    checks = {a["check"] for a in anomalies(plan, last_fetched=200, mode="full")}
    assert checks == {"fetched_drop", "mass_deactivation"}


def test_each_threshold():
    assert anomalies(Plan(fetched=89, valid=89, quarantined=0), 100, "full")[0]["check"] == "fetched_drop"
    assert anomalies(Plan(fetched=90, valid=90, quarantined=0), 100, "full") == []
    deact = Plan(fetched=100, valid=100, quarantined=0, deactivations=11, active_before=100)
    assert anomalies(deact, None, "full")[0]["check"] == "mass_deactivation"
    assert anomalies(deact, None, "delta") == []
    prices = Plan(fetched=100, valid=100, quarantined=0, updates=26, unchanged=74, price_changes=26)
    assert anomalies(prices, None, "full")[0]["check"] == "mass_price_change"
    quarantine = Plan(fetched=100, valid=94, quarantined=6)
    assert anomalies(quarantine, None, "full")[0]["check"] == "quarantine_rate"


def test_row_flags():
    assert row_flags(p(unit_price_cents=1700), 1000)[0]["rule"] == "price_jump"
    assert row_flags(p(unit_price_cents=1500), 1000) == []
    assert row_flags(p(images=[]), None)[0]["rule"] == "image_missing"
    assert row_flags(p(is_alcohol=True), None)[0]["rule"] == "alcohol_blocked"
    assert blocked_reason(p(is_alcohol=True)) == "alcohol_not_licensed"
    assert blocked_reason(p()) is None


def test_taxonomy_is_consistent():
    rows = taxonomy_rows()
    pairs = {(r["category"], r["subcategory"]) for r in rows}
    assert UNCATEGORISED in pairs
    for _, _, c, s in identity_mappings() + type_level_mappings():
        assert (c, s) in pairs
    assert len({r["category_slug"] for r in rows}) == len({r["category"] for r in rows})


def test_dagster_definitions_load_with_both_schedules():
    from catalog_pipeline.definitions import defs

    schedules = {s.name: s for s in defs.schedules}
    assert schedules["catalog_delta_store_hours"].cron_schedule == "*/15 7-21 * * *"
    assert schedules["catalog_full_nightly"].cron_schedule == "0 3 * * *"
    assert {s.execution_timezone for s in schedules.values()} == {"America/Toronto"}
    assert defs.resolve_job_def("catalog_full") and defs.resolve_job_def("catalog_delta")
