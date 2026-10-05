"""`fixture` connector (G3-02): the deterministic synthetic feed from db/seed/generate.mjs.

The default connector. It makes no network calls, so the whole pipeline runs offline.
"""
from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from ..canonical import (
    CanonicalProduct,
    CanonicalPromotion,
    QualityError,
    check_product,
    iso_days,
    price_to_cents,
    weight_lb,
)
from ..taxonomy import identity_mappings
from .base import Mode

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PATH = REPO_ROOT / "db" / "seed" / "catalog.fixture.json"


class FixtureConnector:
    name = "fixture"
    id_prefix = ""  # fixture ids (DEMO-0001) are already unique; keeps existing carts/orders valid

    def __init__(
        self,
        path: str | Path | None = None,
        records: list[dict[str, Any]] | None = None,
        fraction: float | None = None,
    ):
        self.path = Path(path) if path else DEFAULT_PATH
        self._records = records
        if fraction is not None and not 0 < fraction <= 1:
            raise ValueError("CATALOG_FIXTURE_FRACTION must be in (0, 1]")
        self.fraction = fraction

    def load(self) -> dict[str, Any]:
        return json.loads(self.path.read_text(encoding="utf-8"))

    def extract(self, mode: Mode) -> Iterable[dict[str, Any]]:
        # The fixture is a complete snapshot, so delta and full runs read the same feed.
        records = list(self._records) if self._records is not None else self.load()["products"]
        if self.fraction is not None:
            records = records[: max(1, int(len(records) * self.fraction))]
        return records

    def normalise(self, raw: dict[str, Any]) -> CanonicalProduct:
        external_id = str(raw.get("external_id") or "").strip()
        if not external_id:
            raise QualityError("missing external_id")
        weighed = raw.get("pricing_model") == "per_weight"
        unit_price_cents = raw.get("unit_price_cents")
        if not isinstance(unit_price_cents, int) or isinstance(unit_price_cents, bool):
            unit_price_cents = price_to_cents(unit_price_cents)
        promo = raw.get("promotion")
        product = CanonicalProduct(
            external_id=external_id,
            name=str(raw.get("name") or "").strip(),
            brand=raw.get("brand") or None,
            upc=raw.get("upc") or None,
            source_type=str(raw.get("category") or "").strip(),
            source_subtype=str(raw.get("subcategory") or "").strip(),
            description=raw.get("description") or "",
            pricing_model="per_weight" if weighed else "each",
            unit="lb" if weighed else "ea",
            sell_by=(raw.get("sell_by") or "quantity") if weighed else "quantity",
            unit_price_cents=unit_price_cents,
            estimated_weight_lb=weight_lb(raw.get("avg_weight_lb")) if weighed else None,
            tax_code=raw.get("tax_code") or "ZERO_RATED",
            deposit_cents=int(raw.get("deposit_cents") or 0),
            is_alcohol=bool(raw.get("is_alcohol", False)),
            pickup_only=bool(raw.get("pickup_only", False)),
            min_qty=int(raw.get("min_qty") or 0),
            max_qty=int(raw.get("max_qty") or 0),
            available_days=iso_days(raw.get("available_days")),
            organic=bool(raw.get("organic", False)),
            dietary_claims=sorted(set(raw.get("dietary_claims") or [])),
            source_virtual_category="specials" if promo else None,
            images=[i for i in raw.get("images") or [] if i],
            sku=raw.get("sku") or None,
            availability=raw.get("availability") or "in_stock",
            promotions=(
                [
                    CanonicalPromotion(
                        external_id=f"promo-{external_id}",
                        sale_price_cents=int(promo["sale_price_cents"]),
                        label=promo.get("label") or "Special",
                    )
                ]
                if promo
                else []
            ),
        )
        return check_product(product)

    def default_mappings(self) -> list[tuple[str, str, str, str]]:
        return identity_mappings()
