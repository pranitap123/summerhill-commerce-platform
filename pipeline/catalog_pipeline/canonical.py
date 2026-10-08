"""Canonical product model (CATALOG §3) and the helpers every connector shares.

A connector turns each raw source record into a `CanonicalProduct`. Anything that can't be turned
into a valid product raises `QualityError`, and the row goes to quarantine instead of the catalogue.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import asdict, dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

MAX_PRICE_CENTS = 200_000
PLACEHOLDER_IMAGE = "/placeholder-product.svg"
ISO_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
TAX_CODES = ("ZERO_RATED", "HST_STANDARD")


class QualityError(ValueError):
    """A record that violates a data-quality rule; it is quarantined, never loaded."""


@dataclass(frozen=True)
class CanonicalPromotion:
    external_id: str
    sale_price_cents: int
    label: str = "Special"
    kind: str = "price_override"
    starts_at: str | None = None
    ends_at: str | None = None


@dataclass
class CanonicalProduct:
    external_id: str
    name: str
    source_type: str
    source_subtype: str
    unit_price_cents: int
    pricing_model: str = "each"
    unit: str = "ea"
    sell_by: str = "quantity"
    brand: str | None = None
    upc: str | None = None
    description: str = ""
    estimated_weight_lb: str | None = None
    weight_step_lb: str = "0.25"
    min_weight_lb: str = "0.5"
    tax_code: str = "ZERO_RATED"
    deposit_cents: int = 0
    is_alcohol: bool = False
    pickup_only: bool = False
    min_qty: int = 0
    max_qty: int = 0
    available_days: list[int] = field(default_factory=list)
    organic: bool = False
    dietary_claims: list[str] = field(default_factory=list)
    source_virtual_category: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    nutrition_label: str | None = None
    disclaimer: str | None = None
    images: list[str] = field(default_factory=list)
    sku: str | None = None
    source_status: str = "listed"
    availability: str = "in_stock"
    promotions: list[CanonicalPromotion] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "CanonicalProduct":
        data = dict(d)
        data["promotions"] = [CanonicalPromotion(**p) for p in data.get("promotions", [])]
        return cls(**data)


def check_product(p: CanonicalProduct) -> CanonicalProduct:
    """Invariants every connector's output must satisfy (CATALOG §4); raises QualityError."""
    if not p.external_id or not p.external_id.strip():
        raise QualityError("missing external_id")
    if not p.name or not p.name.strip():
        raise QualityError("missing name")
    if p.unit_price_cents <= 0:
        raise QualityError("price must be greater than 0")
    if p.unit_price_cents > MAX_PRICE_CENTS:
        raise QualityError("price above $2,000")
    if p.pricing_model not in ("each", "per_weight"):
        raise QualityError(f"unknown pricing model {p.pricing_model!r}")
    if p.pricing_model == "each" and (p.unit != "ea" or p.sell_by != "quantity"):
        raise QualityError("each-priced products are sold by quantity in 'ea'")
    if p.pricing_model == "per_weight" and p.unit != "lb":
        raise QualityError("per-weight products are priced per lb")
    if p.tax_code not in TAX_CODES:
        raise QualityError(f"unknown tax code {p.tax_code!r}")
    if p.deposit_cents < 0 or p.min_qty < 0 or p.max_qty < 0:
        raise QualityError("negative deposit or quantity limit")
    if p.max_qty and p.min_qty > p.max_qty:
        raise QualityError("min quantity above max quantity")
    if any(d not in range(1, 8) for d in p.available_days):
        raise QualityError("available_days must be ISO weekdays 1-7")
    for promo in p.promotions:
        if promo.sale_price_cents <= 0 or promo.sale_price_cents >= p.unit_price_cents:
            raise QualityError("promotion price must be above 0 and below the regular price")
    return p


def price_to_cents(value: Any) -> int:
    """Dollars → integer cents. Rejects missing values and more than 2 decimal places (CATALOG §4)."""
    if value is None or value == "" or isinstance(value, bool):
        raise QualityError("missing price")
    try:
        d = Decimal(str(value))
    except InvalidOperation as exc:
        raise QualityError(f"price is not a number: {value!r}") from exc
    if not d.is_finite():
        raise QualityError(f"price is not a number: {value!r}")
    if d.as_tuple().exponent < -2 and d != d.quantize(Decimal("0.01")):
        raise QualityError(f"price has more than 2 decimal places: {value}")
    return int((d * 100).to_integral_value(rounding=ROUND_HALF_UP))


def convert_per_weight_cents(cents: int, unit: str) -> int:
    """Price per kg or per 100 g → price per lb (the only weight unit we sell by)."""
    factor = {"lb": Decimal(1), "kg": Decimal("0.45359237"), "100g": Decimal("4.5359237")}[unit]
    return int((Decimal(cents) * factor).to_integral_value(rounding=ROUND_HALF_UP))


def weight_lb(value: Any) -> str | None:
    """A positive weight as a decimal string with at most 3 decimals, else None."""
    if value in (None, "", 0) or isinstance(value, bool):
        return None
    try:
        d = Decimal(str(value))
    except InvalidOperation:
        return None
    if not d.is_finite() or d <= 0:
        return None
    return str(d.quantize(Decimal("0.001")).normalize())


def iso_days(values: Any) -> list[int]:
    """Day names ('Monday', 'mon') or ISO numbers (1 = Monday … 7 = Sunday) → sorted ISO numbers."""
    out: set[int] = set()
    for v in values or []:
        if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 7:
            out.add(v)
            continue
        name = str(v).strip().lower()
        match = [i + 1 for i, day in enumerate(ISO_DAYS) if name and day.startswith(name[:3])]
        if len(name) < 3 or not match:
            raise QualityError(f"unknown weekday {v!r}")
        out.add(match[0])
    return sorted(out)


_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def slugify(text: str, max_len: int = 60) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = _NON_ALNUM.sub("-", ascii_text.lower()).strip("-")
    return slug[:max_len].rstrip("-") or "item"


def product_slug(name: str, merchant_id: int, external_id: str) -> str:
    """Readable and unique: the name plus a short hash of the product's identity."""
    suffix = hashlib.md5(f"{merchant_id}:{external_id}".encode(), usedforsecurity=False).hexdigest()[:6]
    return f"{slugify(name)}-{suffix}"


def source_hash(payload: dict[str, Any]) -> str:
    """Stable hash of a normalised payload: equal hash means nothing to write (CATALOG §4)."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()
