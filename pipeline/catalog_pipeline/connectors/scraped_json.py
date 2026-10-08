"""`scraped_json` connector: reads the Stage 1 scraper's output file (scripts/scraper.js).

The file is a list of `{category, subcategory, products: [...]}` groups. Nothing is fetched, so
it needs no credentials. Product ids are prefixed `sc-`, so they never collide with the fixture.

Environment:
  SCRAPED_JSON_PATH   the scraper output (default: scraped.json in the repo root)

The scraper's output has no unit, tax or weight data, so every product is a priced-each,
zero-rated item. Real categories are mapped onto the platform taxonomy at category level
(see ops → catalogue mappings); unmapped ones land in "Uncategorised".
"""
from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from ..canonical import CanonicalProduct, QualityError, check_product, price_to_cents
from ..taxonomy import type_level_mappings
from .base import Mode

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PATH = REPO_ROOT / "scraped.json"


class ScrapedJsonConnector:
    name = "scraped_json"
    id_prefix = "sc-"

    def __init__(self, path: str | Path | None = None, groups: list[dict[str, Any]] | None = None):
        self.path = Path(path) if path else DEFAULT_PATH
        self._groups = groups

    def extract(self, mode: Mode) -> Iterable[dict[str, Any]]:
        groups = self._groups
        if groups is None:
            if not self.path.exists():
                raise FileNotFoundError(f"{self.path} not found: run `npm run scrape` first (docs/SCRAPER.md)")
            groups = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(groups, list):
            raise QualityError("scraped file must be a list of category groups")
        records: list[dict[str, Any]] = []
        for group in groups:
            for product in group.get("products") or []:
                records.append(
                    {
                        **product,
                        "category": product.get("category") or group.get("category"),
                        "subcategory": product.get("subcategory") or group.get("subcategory"),
                    }
                )
        return records

    def normalise(self, raw: dict[str, Any]) -> CanonicalProduct:
        external_id = str(raw.get("id") or "").strip()
        if not external_id:
            raise QualityError("missing external_id")
        sku = str(raw["sku"]).strip() if raw.get("sku") else None
        product = CanonicalProduct(
            external_id=external_id,
            name=str(raw.get("name") or "").strip(),
            upc=sku,
            source_type=str(raw.get("category") or "").strip(),
            source_subtype=str(raw.get("subcategory") or "").strip(),
            description=str(raw.get("description") or "").strip(),
            unit_price_cents=price_to_cents(raw.get("price")),
            images=[i for i in raw.get("images") or [] if i],
            sku=sku,
            availability="in_stock" if raw.get("availability") == "in_stock" else "out_of_stock",
        )
        return check_product(product)

    def default_mappings(self) -> list[tuple[str, str, str, str]]:
        return type_level_mappings()
