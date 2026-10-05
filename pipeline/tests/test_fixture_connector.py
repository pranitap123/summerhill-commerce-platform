from catalog_pipeline.connectors import get_connector
from catalog_pipeline.connectors.fixture import FixtureConnector
from catalog_pipeline.taxonomy import identity_mappings


def normalised():
    c = FixtureConnector()
    return c, [c.normalise(r) for r in c.extract("full")]


def test_every_fixture_row_is_valid_and_ids_are_unique():
    c, products = normalised()
    assert len(products) == len(c.load()["products"]) >= 200
    assert len({p.external_id for p in products}) == len(products)


def test_extract_is_deterministic_and_offline():
    a = [p.to_dict() for p in normalised()[1]]
    b = [p.to_dict() for p in normalised()[1]]
    assert a == b


def test_fixture_covers_every_rule_the_model_supports():
    _, ps = normalised()
    assert any(p.pricing_model == "per_weight" and p.sell_by == "weight" for p in ps)
    assert any(p.pricing_model == "per_weight" and p.sell_by == "quantity" and p.estimated_weight_lb for p in ps)
    assert any(p.pricing_model == "per_weight" and p.estimated_weight_lb is None for p in ps)
    assert {p.tax_code for p in ps} == {"ZERO_RATED", "HST_STANDARD"}
    assert any(p.deposit_cents for p in ps)
    assert any(p.available_days == [1, 2, 3, 4, 5, 6] for p in ps)
    assert any(p.promotions and p.source_virtual_category == "specials" for p in ps)
    assert any(p.availability == "out_of_stock" for p in ps)
    assert any(p.organic for p in ps) and any(p.dietary_claims for p in ps)
    assert any(p.min_qty for p in ps) and any(p.max_qty for p in ps)


def test_each_items_never_carry_weights():
    _, ps = normalised()
    for p in ps:
        if p.pricing_model == "each":
            assert (p.unit, p.sell_by, p.estimated_weight_lb) == ("ea", "quantity", None)


def test_all_fixture_source_categories_are_mapped():
    _, ps = normalised()
    mapped = {(t, s) for t, s, _, _ in identity_mappings()}
    assert {(p.source_type, p.source_subtype) for p in ps} <= mapped


def test_registry_default_is_fixture():
    assert get_connector("fixture", {}).name == "fixture"
