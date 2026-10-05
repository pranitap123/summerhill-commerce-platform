import pytest

from catalog_pipeline.canonical import (
    CanonicalProduct,
    CanonicalPromotion,
    QualityError,
    check_product,
    convert_per_weight_cents,
    iso_days,
    price_to_cents,
    product_slug,
    slugify,
    source_hash,
    weight_lb,
)


def product(**kw) -> CanonicalProduct:
    base = dict(external_id="X1", name="Thing", source_type="Produce", source_subtype="Fresh Fruit", unit_price_cents=499)
    return CanonicalProduct(**{**base, **kw})


@pytest.mark.parametrize(
    "value,cents", [(4.99, 499), ("4.99", 499), ("4.5", 450), (10, 1000), ("0.01", 1), ("2.500", 250)]
)
def test_price_to_cents(value, cents):
    assert price_to_cents(value) == cents


@pytest.mark.parametrize("value", [None, "", "abc", True, "1.999", "NaN", "Infinity"])
def test_price_to_cents_rejects(value):
    with pytest.raises(QualityError):
        price_to_cents(value)


def test_per_weight_units_convert_to_per_lb():
    assert convert_per_weight_cents(1000, "lb") == 1000
    assert convert_per_weight_cents(1000, "kg") == 454  # $10/kg = $4.54/lb
    assert convert_per_weight_cents(100, "100g") == 454  # $1/100 g = $4.54/lb


def test_weight_lb():
    assert weight_lb("1.5") == "1.5"
    assert weight_lb(1.5678) == "1.568"
    assert weight_lb(0) is None
    assert weight_lb(-1) is None
    assert weight_lb("x") is None


def test_iso_days():
    assert iso_days(["Monday", "sat", "Sunday"]) == [1, 6, 7]
    assert iso_days([7, 1, 1]) == [1, 7]
    assert iso_days(None) == []
    with pytest.raises(QualityError):
        iso_days(["Funday"])


def test_slugs_are_readable_stable_and_unique_per_product():
    assert slugify("Crème Brûlée & Co. 12 ea") == "creme-brulee-co-12-ea"
    assert slugify("!!!") == "item"
    a = product_slug("Bananas", 1, "DEMO-0001")
    assert a.startswith("bananas-") and a == product_slug("Bananas", 1, "DEMO-0001")
    assert a != product_slug("Bananas", 1, "DEMO-0002")
    assert a != product_slug("Bananas", 2, "DEMO-0001")


def test_source_hash_ignores_key_order():
    assert source_hash({"a": 1, "b": [1, 2]}) == source_hash({"b": [1, 2], "a": 1})
    assert source_hash({"a": 1}) != source_hash({"a": 2})


@pytest.mark.parametrize(
    "kw,reason",
    [
        ({"external_id": " "}, "external_id"),
        ({"name": ""}, "name"),
        ({"unit_price_cents": 0}, "greater than 0"),
        ({"unit_price_cents": 200_001}, "$2,000"),
        ({"pricing_model": "per_weight", "unit": "ea"}, "per lb"),
        ({"unit": "lb"}, "each-priced"),
        ({"tax_code": "GST"}, "tax code"),
        ({"min_qty": 5, "max_qty": 2}, "min quantity"),
        ({"available_days": [0]}, "ISO"),
        ({"promotions": [CanonicalPromotion("p", 499)]}, "promotion"),
    ],
)
def test_check_product_rules(kw, reason):
    with pytest.raises(QualityError, match=reason.replace("$", r"\$")):
        check_product(product(**kw))


def test_round_trip_through_dict():
    p = product(promotions=[CanonicalPromotion("p1", 399)], available_days=[1, 2])
    assert CanonicalProduct.from_dict(p.to_dict()) == p
