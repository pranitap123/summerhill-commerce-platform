"""`homesome_api` connector (G3-03): a merchant's store API. **Opt-in only.**

Use it only with the data owner's permission and your own credentials. It identifies itself
honestly (no browser user agent, no spoofed Origin/Referer), uses timeouts and bounded retries,
and is disabled unless HOMESOME_ENABLED=true and every credential is set. Nothing it fetches may be
committed to the repository (see /pipeline/README.md).

Environment:
  HOMESOME_ENABLED=true           explicit opt-in
  HOMESOME_BASE_URL               e.g. https://api.example.com/v1
  HOMESOME_API_KEY, HOMESOME_LOCATION_ID, HOMESOME_PRICELIST_ID
  HOMESOME_IMAGE_BASE             optional; image URL prefix for `mainImage`
  HOMESOME_PROMOTIONS_PATH        optional; path of the promotions endpoint (no promotions if unset)
  HOMESOME_CONTACT                optional; contact address added to the User-Agent
"""
from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from ..canonical import (
    CanonicalProduct,
    CanonicalPromotion,
    QualityError,
    check_product,
    convert_per_weight_cents,
    iso_days,
    price_to_cents,
    weight_lb,
)
from ..promotions import attach_promotions_by_upc
from ..taxonomy import type_level_mappings
from .base import Mode

REQUIRED = ("HOMESOME_BASE_URL", "HOMESOME_API_KEY", "HOMESOME_LOCATION_ID", "HOMESOME_PRICELIST_ID")
TIMEOUT = (5, 30)  # connect, read (seconds)
HST_RATES = {13, 0.13}


class ConnectorDisabled(RuntimeError):
    pass


def make_session(retries: int = 3) -> requests.Session:
    retry = Retry(
        total=retries,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
        respect_retry_after_header=True,
    )
    session = requests.Session()
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.mount("http://", HTTPAdapter(max_retries=retry))
    return session


def _bool(v: Any) -> bool:
    return v is True or (isinstance(v, str) and v.strip().lower() in ("true", "1", "yes"))


def _claims(v: Any) -> list[str]:
    """healthClaims arrive as a list of names or a {name: bool} object."""
    if isinstance(v, Mapping):
        return sorted(k for k, on in v.items() if _bool(on) or on is True)
    return sorted({str(x) for x in v or [] if x})


class HomesomeApiConnector:
    name = "homesome_api"
    id_prefix = "hs-"

    def __init__(self, env: Mapping[str, str] | None = None, session: requests.Session | None = None):
        env = os.environ if env is None else env
        if not _bool(env.get("HOMESOME_ENABLED")):
            raise ConnectorDisabled("homesome_api is disabled: set HOMESOME_ENABLED=true (needs the data owner's permission)")
        missing = [k for k in REQUIRED if not env.get(k)]
        if missing:
            raise ConnectorDisabled(f"homesome_api is missing configuration: {', '.join(missing)}")
        self.base_url = env["HOMESOME_BASE_URL"].rstrip("/")
        self.image_base = (env.get("HOMESOME_IMAGE_BASE") or "").rstrip("/")
        self.promotions_path = env.get("HOMESOME_PROMOTIONS_PATH") or None
        contact = env.get("HOMESOME_CONTACT")
        self.headers = {
            "apikey": env["HOMESOME_API_KEY"],
            "location": env["HOMESOME_LOCATION_ID"],
            "pricelist": env["HOMESOME_PRICELIST_ID"],
            "accept": "application/json",
            # Honest identification; never a browser user agent or a spoofed Origin/Referer
            "user-agent": f"grocery-marketplace-demo-pipeline/1.0{f' (+{contact})' if contact else ''}",
        }
        self.session = session or make_session()
        self.flags: list[dict] = []

    def _get(self, path: str) -> Any:
        res = self.session.get(f"{self.base_url}{path}", headers=self.headers, timeout=TIMEOUT)
        res.raise_for_status()
        return res.json()

    def extract(self, mode: Mode) -> Iterable[dict[str, Any]]:
        # The API has no change feed, so a delta run reads the full list too; only the full run
        # deactivates products that disappeared.
        products = self._get("/product/list?listType=ui").get("products", [])
        self._promotions = self._get(self.promotions_path) if self.promotions_path else None
        return products

    def normalise(self, raw: dict[str, Any]) -> CanonicalProduct:
        external_id = str(raw.get("name") or "").strip()
        if not external_id:
            raise QualityError("missing external_id")
        unit = str(raw.get("unit") or "count").strip().lower()
        if unit in ("count", "each", "ea", "unit"):
            weighed, per = False, None
        elif unit in ("lb", "kg", "100g"):
            weighed, per = True, unit
        else:
            raise QualityError(f"unknown unit {unit!r}")
        cents = price_to_cents(raw.get("price"))
        if weighed:
            cents = convert_per_weight_cents(cents, per)
        taxable = _bool(raw.get("isTaxable"))
        rate = raw.get("taxRate")
        if taxable and rate not in (None, "") and float(rate) not in HST_RATES:
            raise QualityError(f"unsupported tax rate {rate!r}")
        image_key = raw.get("mainImage")
        image = f"{self.image_base}/{image_key}.jpg" if image_key and self.image_base else None
        product = CanonicalProduct(
            external_id=external_id,
            name=str(raw.get("displayName") or "").strip(),
            brand=(raw.get("brand") or None),
            upc=(str(raw["upc"]).strip() if raw.get("upc") else None),
            source_type=str(raw.get("type") or "").strip(),
            source_subtype=str(raw.get("subType") or "").strip(),
            description=raw.get("description") or "",
            pricing_model="per_weight" if weighed else "each",
            unit="lb" if weighed else "ea",
            sell_by=("quantity" if _bool(raw.get("sellByQty")) else "weight") if weighed else "quantity",
            unit_price_cents=cents,
            estimated_weight_lb=weight_lb(raw.get("avgWeight")) if weighed else None,
            tax_code="HST_STANDARD" if taxable else "ZERO_RATED",
            deposit_cents=price_to_cents(raw["bottleFee"]) if raw.get("bottleFee") else 0,
            is_alcohol=_bool(raw.get("isAlcohol")),
            pickup_only=_bool(raw.get("isPickupOnly")),
            min_qty=int(raw.get("minQuantity") or 0),
            max_qty=int(raw.get("maxQuantity") or 0),
            available_days=iso_days(raw.get("availableDays")),
            organic=_bool(raw.get("organic")),
            dietary_claims=_claims(raw.get("healthClaims")),
            source_virtual_category=(str(raw["virtualCategory"]).lower() if raw.get("virtualCategory") else None),
            attributes=dict(raw.get("attributes") or {}),
            nutrition_label=raw.get("nutritionLabel") or None,
            disclaimer=raw.get("disclaimer") or None,
            images=[image] if image else [],
            sku=(str(raw["upc"]).strip() if raw.get("upc") else None),
            source_status="listed" if _bool(raw.get("availableToOrder", True)) else "unlisted",
            availability="in_stock" if _bool(raw.get("isInStock", True)) else "out_of_stock",
        )
        return check_product(product)

    def post_process(self, products: list[CanonicalProduct]) -> list[CanonicalProduct]:
        """Attach UPC-keyed promotions (`promotions.items[upc].primary[].salePrice`)."""
        if not self._promotions_payload():
            return products
        by_upc: dict[str, list[CanonicalPromotion]] = {}
        for upc, entry in (self._promotions_payload().get("items") or {}).items():
            promos = []
            for i, p in enumerate((entry or {}).get("primary") or []):
                try:
                    cents = price_to_cents(p.get("salePrice"))
                except QualityError:
                    self.flags.append({"rule": "promotion_bad_price", "upc": upc})
                    continue
                promos.append(
                    CanonicalPromotion(
                        external_id=str(p.get("id") or f"{upc}-{i}"),
                        sale_price_cents=cents,
                        label=p.get("label") or "Special",
                    )
                )
            if promos:
                by_upc[str(upc)] = promos
        out, flags = attach_promotions_by_upc(products, by_upc)
        self.flags.extend(flags)
        return out

    def _promotions_payload(self) -> dict | None:
        payload = getattr(self, "_promotions", None)
        if isinstance(payload, Mapping) and "promotions" in payload:
            payload = payload["promotions"]
        return payload if isinstance(payload, Mapping) else None

    def default_mappings(self) -> list[tuple[str, str, str, str]]:
        return type_level_mappings()
