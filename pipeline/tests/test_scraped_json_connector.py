"""The `scraped_json` connector reads the Stage 1 scraper's output (docs/SCRAPER.md)."""
import json
from pathlib import Path

import pytest

from catalog_pipeline.canonical import QualityError
from catalog_pipeline.connectors import get_connector
from catalog_pipeline.connectors.scraped_json import ScrapedJsonConnector
from catalog_pipeline.ingest import run_ingest

SAMPLE = Path(__file__).resolve().parents[2] / "docs" / "samples" / "scraped.sample.json"


def test_registry_builds_it_from_the_environment(tmp_path):
    c = get_connector("scraped_json", {"SCRAPED_JSON_PATH": str(tmp_path / "x.json")})
    assert isinstance(c, ScrapedJsonConnector) and c.path == tmp_path / "x.json"


def test_extract_flattens_groups_and_keeps_the_category():
    records = list(ScrapedJsonConnector(path=SAMPLE).extract("full"))
    assert len(records) == 5
    assert {r["category"] for r in records} == {"Dairy & Eggs", "Produce"}


def test_normalise_maps_the_scraper_fields():
    c = ScrapedJsonConnector(path=SAMPLE)
    p = c.normalise(next(iter(c.extract("full"))))
    assert (p.external_id, p.name, p.unit_price_cents, p.sku) == ("000000000011", "Free-Range Eggs Large 12 Count", 549, "000000000011")
    assert (p.source_type, p.source_subtype, p.availability) == ("Dairy & Eggs", "Eggs", "in_stock")
    assert p.images == ["https://images.example.test/products/000000000011.jpg"]
    assert p.description == "Example Farm. Sold by count"


def test_out_of_stock_and_bad_rows():
    c = ScrapedJsonConnector(groups=[])
    base = {"id": "1", "name": "A", "price": 1.5, "category": "Produce", "subcategory": "Fruit"}
    assert c.normalise({**base, "availability": "out_of_stock"}).availability == "out_of_stock"
    with pytest.raises(QualityError):
        c.normalise({**base, "id": ""})
    with pytest.raises(QualityError):
        c.normalise({**base, "price": None})
    with pytest.raises(QualityError):
        c.normalise({**base, "price": 1.999})


def test_missing_file_explains_how_to_get_one(tmp_path):
    with pytest.raises(FileNotFoundError, match="npm run scrape"):
        ScrapedJsonConnector(path=tmp_path / "nope.json").extract("full")


def test_a_non_list_file_is_rejected(tmp_path):
    f = tmp_path / "bad.json"
    f.write_text(json.dumps({"products": []}))
    with pytest.raises(QualityError):
        ScrapedJsonConnector(path=f).extract("full")


@pytest.mark.db
def test_ingests_the_sample_into_postgres(db):
    r = run_ingest(db.ingest_url, ScrapedJsonConnector(path=SAMPLE), "demo-market", "downtown", "full")
    assert (r.status, r.fetched, r.inserted, r.quarantined) == ("applied", 5, 5, 0)
    ids = {row[0] for row in db.sql("SELECT external_id FROM catalog.products")}
    assert "000000000011" in ids
    again = run_ingest(db.ingest_url, ScrapedJsonConnector(path=SAMPLE), "demo-market", "downtown", "full")
    assert (again.inserted, again.updated, again.unchanged) == (0, 0, 5)
