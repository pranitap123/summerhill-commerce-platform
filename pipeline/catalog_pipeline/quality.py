"""Data-quality rules and the anomaly guard (CATALOG §4, G3-05).

Row rules quarantine bad records or flag suspicious ones. The anomaly guard looks at the whole run:
if the feed looks broken, nothing is applied and the run waits for an admin (threat T17: a poisoned
or truncated upstream feed must never wipe or corrupt the live catalogue).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .canonical import CanonicalProduct

# Anomaly guard thresholds
MIN_FETCHED_RATIO = 0.90  # fetched < 90% of the last successful run
MAX_DEACTIVATED_RATIO = 0.10  # > 10% of active products would be deactivated
MAX_PRICE_CHANGED_RATIO = 0.25  # > 25% of prices changed
MAX_QUARANTINED_RATIO = 0.05  # quarantined > 5% of the total
# Row flag: price changed by more than ±60% (applied, but reported)
PRICE_JUMP_RATIO = 0.60


@dataclass
class Plan:
    """What applying a run would change, computed before touching the catalogue."""

    fetched: int
    valid: int
    quarantined: int
    inserts: int = 0
    updates: int = 0
    unchanged: int = 0
    deactivations: int = 0
    price_changes: int = 0
    active_before: int = 0
    flags: list[dict[str, Any]] = field(default_factory=list)


def row_flags(product: CanonicalProduct, previous_price_cents: int | None) -> list[dict[str, Any]]:
    flags = []
    if previous_price_cents:
        change = abs(product.unit_price_cents - previous_price_cents) / previous_price_cents
        if change > PRICE_JUMP_RATIO:
            flags.append(
                {
                    "rule": "price_jump",
                    "external_id": product.external_id,
                    "from": previous_price_cents,
                    "to": product.unit_price_cents,
                }
            )
    if not product.images:
        flags.append({"rule": "image_missing", "external_id": product.external_id})
    if product.is_alcohol:
        flags.append({"rule": "alcohol_blocked", "external_id": product.external_id})
    return flags


def blocked_reason(product: CanonicalProduct) -> str | None:
    # Alcohol is ingested but never sold until licensing is resolved (CATALOG §4)
    return "alcohol_not_licensed" if product.is_alcohol else None


def anomalies(plan: Plan, last_fetched: int | None, mode: str) -> list[dict[str, Any]]:
    """Checks that hold the run for approval. Empty list = safe to apply."""
    found: list[dict[str, Any]] = []
    if last_fetched and plan.fetched < MIN_FETCHED_RATIO * last_fetched:
        found.append({"check": "fetched_drop", "fetched": plan.fetched, "last_fetched": last_fetched})
    if mode == "full" and plan.active_before and plan.deactivations > MAX_DEACTIVATED_RATIO * plan.active_before:
        found.append(
            {"check": "mass_deactivation", "deactivations": plan.deactivations, "active": plan.active_before}
        )
    compared = plan.updates + plan.unchanged
    if compared and plan.price_changes > MAX_PRICE_CHANGED_RATIO * compared:
        found.append({"check": "mass_price_change", "price_changes": plan.price_changes, "compared": compared})
    if plan.fetched and plan.quarantined > MAX_QUARANTINED_RATIO * plan.fetched:
        found.append({"check": "quarantine_rate", "quarantined": plan.quarantined, "fetched": plan.fetched})
    return found
