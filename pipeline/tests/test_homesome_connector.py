"""homesome_api (G3-03/G3-04/G3-07): opt-in, honest HTTP, and a mapping test for every field.
No network: the HTTP session is a fake."""
import pytest

from catalog_pipeline.canonical import CanonicalPromotion, QualityError
from catalog_pipeline.connectors import ConnectorDisabled, get_connector
from catalog_pipeline.connectors.homesome_api import TIMEOUT, HomesomeApiConnector, make_session
from catalog_pipeline.promotions import attach_promotions_by_upc

ENV = {
    "HOMESOME_ENABLED": "true",
    "HOMESOME_BASE_URL": "https://api.example.test/v1/",
    "HOMESOME_API_KEY": "test-key",
    "HOMESOME_LOCATION_ID": "loc-1",
    "HOMESOME_PRICELIST_ID": "pl-1",
    "HOMESOME_IMAGE_BASE": "https://img.example.test",
    "HOMESOME_PROMOTIONS_PATH": "/promotion/list",
}

RAW = {
    "name": "091037550460",
    "displayName": "Organic Bananas",
    "brand": "Example Farms",
    "upc": "4011",
    "type": "Produce",
    "subType": "Fresh Fruit",
    "description": "Sweet.",
    "unit": "lb",
    "price": 0.89,
    "sellByQty": True,
    "avgWeight": 1.5,
    "isTaxable": False,
    "taxRate": 0,
    "bottleFee": 0,
    "isAlcohol": False,
    "isPickupOnly": True,
    "minQuantity": 0,
    "maxQuantity": 12,
    "availableDays": ["Monday", "Tuesday"],
    "organic": True,
    "healthClaims": {"vegan": True, "glutenFree": True, "kosher": False},
    "virtualCategory": "Specials",
    "attributes": {"origin": "Ecuador"},
    "nutritionLabel": "Per 100 g: 89 kcal",
    "disclaimer": "Check the label.",
    "mainImage": "bananas",
    "availableToOrder": True,
    "isInStock": True,
}


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, url, headers=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        path = url.split("/v1", 1)[1]
        return FakeResponse(self.responses[path])


def connector(session=None, **env):
    return HomesomeApiConnector({**ENV, **env}, session=session)


def test_disabled_unless_explicitly_enabled():
    with pytest.raises(ConnectorDisabled, match="HOMESOME_ENABLED"):
        get_connector("homesome_api", {k: v for k, v in ENV.items() if k != "HOMESOME_ENABLED"})
    with pytest.raises(ConnectorDisabled, match="HOMESOME_API_KEY"):
        HomesomeApiConnector({**ENV, "HOMESOME_API_KEY": ""})


def test_identifies_honestly_with_timeouts_and_retries():
    session = FakeSession({"/product/list?listType=ui": {"products": [RAW]}, "/promotion/list": {}})
    c = connector(session)
    assert list(c.extract("full")) == [RAW]
    call = session.calls[0]
    headers = {k.lower(): v for k, v in call["headers"].items()}
    assert call["timeout"] == TIMEOUT
    assert "origin" not in headers and "referer" not in headers
    assert "mozilla" not in headers["user-agent"].lower()
    assert headers["user-agent"].startswith("grocery-marketplace-demo-pipeline/")
    retry = make_session().get_adapter("https://x").max_retries
    assert retry.total == 3 and 429 in retry.status_forcelist and retry.respect_retry_after_header


def test_maps_every_field():
    p = connector().normalise(RAW)
    assert p.external_id == "091037550460"
    assert p.name == "Organic Bananas"
    assert p.brand == "Example Farms"
    assert p.upc == "4011" and p.sku == "4011"
    assert (p.source_type, p.source_subtype) == ("Produce", "Fresh Fruit")
    assert p.description == "Sweet."
    assert (p.pricing_model, p.unit, p.sell_by) == ("per_weight", "lb", "quantity")
    assert p.unit_price_cents == 89
    assert p.estimated_weight_lb == "1.5"
    assert p.tax_code == "ZERO_RATED"
    assert p.deposit_cents == 0
    assert p.is_alcohol is False and p.pickup_only is True
    assert (p.min_qty, p.max_qty) == (0, 12)
    assert p.available_days == [1, 2]
    assert p.organic is True
    assert p.dietary_claims == ["glutenFree", "vegan"]
    assert p.source_virtual_category == "specials"
    assert p.attributes == {"origin": "Ecuador"}
    assert p.nutrition_label == "Per 100 g: 89 kcal"
    assert p.disclaimer == "Check the label."
    assert p.images == ["https://img.example.test/bananas.jpg"]
    assert (p.source_status, p.availability) == ("listed", "in_stock")


def test_field_variants():
    c = connector()
    each = c.normalise({**RAW, "unit": "count", "avgWeight": 2, "sellByQty": False})
    assert (each.pricing_model, each.unit, each.sell_by, each.estimated_weight_lb) == ("each", "ea", "quantity", None)
    by_weight = c.normalise({**RAW, "sellByQty": False})
    assert by_weight.sell_by == "weight"
    per_kg = c.normalise({**RAW, "unit": "kg", "price": 10})
    assert per_kg.unit_price_cents == 454
    taxed = c.normalise({**RAW, "isTaxable": True, "taxRate": 13, "bottleFee": 0.1})
    assert taxed.tax_code == "HST_STANDARD" and taxed.deposit_cents == 10
    claims = c.normalise({**RAW, "healthClaims": ["vegan", "vegan", "kosher"]})
    assert claims.dietary_claims == ["kosher", "vegan"]
    unlisted = c.normalise({**RAW, "availableToOrder": False, "isInStock": False, "mainImage": None})
    assert (unlisted.source_status, unlisted.availability, unlisted.images) == ("unlisted", "out_of_stock", [])


@pytest.mark.parametrize(
    "patch,reason",
    [
        ({"name": ""}, "external_id"),
        ({"displayName": None}, "name"),
        ({"price": None}, "missing price"),
        ({"price": 1.234}, "decimal places"),
        ({"price": 0}, "greater than 0"),
        ({"price": 2500}, "2,000"),
        ({"unit": "dozen"}, "unit"),
        ({"isTaxable": True, "taxRate": 5}, "tax rate"),
        ({"availableDays": ["Someday"]}, "weekday"),
    ],
)
def test_bad_records_are_rejected(patch, reason):
    with pytest.raises(QualityError, match=reason):
        connector().normalise({**RAW, **patch})


def test_promotions_by_upc_apply_to_every_match_with_a_warning():
    c = connector()
    a = c.normalise({**RAW, "name": "A", "unit": "count", "price": 5, "upc": "111", "virtualCategory": None})
    b = c.normalise({**RAW, "name": "B", "unit": "count", "price": 6, "upc": "111", "virtualCategory": None})
    other = c.normalise({**RAW, "name": "C", "unit": "count", "price": 7, "upc": "222", "virtualCategory": None})
    c._promotions = {"promotions": {"items": {"111": {"primary": [{"id": "p1", "salePrice": 3.99}]},
                                              "999": {"primary": [{"salePrice": 1}]}}}}
    out = {p.external_id: p for p in c.post_process([a, b, other])}
    assert out["A"].promotions == [CanonicalPromotion("p1", 399)]
    assert out["B"].promotions == [CanonicalPromotion("p1", 399)]
    assert out["A"].source_virtual_category == "specials"
    assert out["C"].promotions == []
    rules = [f["rule"] for f in c.flags]
    assert "promotion_duplicate_upc" in rules and "promotion_unknown_upc" in rules


def test_sale_price_not_below_regular_price_is_skipped():
    c = connector()
    p = c.normalise({**RAW, "unit": "count", "price": 2})
    out, flags = attach_promotions_by_upc([p], {"4011": [CanonicalPromotion("p", 250)]})
    assert out[0].promotions == [] and flags[0]["rule"] == "promotion_not_below_price"
