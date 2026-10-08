"""Promotions keyed by UPC (CATALOG §3.1, G3-07).

Upstream promotions reference products by UPC, which isn't unique: when a UPC matches more than one
product, the promotion applies to all of them and a warning is recorded.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import replace

from .canonical import CanonicalProduct, CanonicalPromotion

log = logging.getLogger(__name__)


def attach_promotions_by_upc(
    products: list[CanonicalProduct],
    promos_by_upc: dict[str, list[CanonicalPromotion]],
) -> tuple[list[CanonicalProduct], list[dict]]:
    """Returns the products with their promotions attached, plus flags for the run report."""
    by_upc: dict[str, list[int]] = defaultdict(list)
    for i, p in enumerate(products):
        if p.upc:
            by_upc[p.upc].append(i)
    flags: list[dict] = []
    out = list(products)
    for upc, promos in promos_by_upc.items():
        matches = by_upc.get(upc, [])
        if not matches:
            flags.append({"rule": "promotion_unknown_upc", "upc": upc})
            continue
        if len(matches) > 1:
            ids = [products[i].external_id for i in matches]
            log.warning("promotion UPC %s matches %d products: %s", upc, len(ids), ids)
            flags.append({"rule": "promotion_duplicate_upc", "upc": upc, "external_ids": ids})
        for i in matches:
            p = out[i]
            valid = [pr for pr in promos if 0 < pr.sale_price_cents < p.unit_price_cents]
            if len(valid) < len(promos):
                flags.append({"rule": "promotion_not_below_price", "upc": upc, "external_id": p.external_id})
            if valid:
                out[i] = replace(
                    p,
                    promotions=sorted({*p.promotions, *valid}, key=lambda x: x.external_id),
                    source_virtual_category=p.source_virtual_category or "specials",
                )
    return out, flags
