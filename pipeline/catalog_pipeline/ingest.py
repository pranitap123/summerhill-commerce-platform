"""One ingest run (CATALOG §2, G3-02…G3-06, G3-14):

  extract → normalise → quality rules (quarantine) → map categories → diff by external_id and
  source_hash → anomaly guard (hold) → apply in one transaction → outbox `product.changed`

A re-run over an unchanged feed writes no product rows. Products missing from a *full* run are
soft-deleted (never hard-deleted: carts and orders reference them). Overrides are never touched.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .canonical import PLACEHOLDER_IMAGE, CanonicalProduct, QualityError, product_slug, source_hash
from .connectors.base import Mode, SourceConnector
from .quality import Plan, anomalies, blocked_reason, row_flags
from .taxonomy import UNCATEGORISED, taxonomy_rows

log = logging.getLogger(__name__)


@dataclass
class RunResult:
    run_id: int
    status: str
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    deactivated: int = 0
    quarantined: int = 0
    anomalies: list[dict[str, Any]] = field(default_factory=list)
    flags: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None

    def summary(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if k != "flags"} | {"flags": len(self.flags)}


class IngestError(RuntimeError):
    pass


def connect(conninfo: str) -> psycopg.Connection:
    return psycopg.connect(conninfo, row_factory=dict_row)




def run_ingest(
    conninfo: str,
    connector: SourceConnector,
    merchant_slug: str,
    location_slug: str,
    mode: Mode = "full",
    force: bool = False,
) -> RunResult:
    started = time.monotonic()
    with connect(conninfo) as conn:
        merchant_id, location_id = _merchant_and_location(conn, merchant_slug, location_slug)
        run_id = _start_run(conn, merchant_id, connector.name, mode)
        try:
            raw_records = list(connector.extract(mode))
            products, quarantine = _normalise(connector, raw_records)
            flags = list(getattr(connector, "flags", []))
            result = _plan_and_apply(
                conn, run_id, connector, merchant_id, location_id, mode, products, quarantine,
                fetched=len(raw_records), flags=flags, force=force, approved_by=None,
            )
        except Exception as exc:
            conn.rollback()
            _finish_run(conn, run_id, "failed", started, error=f"{type(exc).__name__}: {exc}")
            log.exception("ingest run %s failed", run_id)
            return RunResult(run_id=run_id, status="failed", error=str(exc))
        _finish_run(conn, run_id, result.status, started)
        return result


def approve_run(conninfo: str, run_id: int, approved_by: str, connector: SourceConnector) -> RunResult:
    """Applies a held run's staged feed as-is (the anomaly guard is overridden by a person)."""
    started = time.monotonic()
    with connect(conninfo) as conn:
        run = conn.execute(
            "SELECT * FROM ops.ingest_runs WHERE id = %s FOR UPDATE", (run_id,)
        ).fetchone()
        if not run or run["status"] != "held":
            raise IngestError(f"run {run_id} is not held")
        location_id = conn.execute(
            "SELECT location_id FROM catalog.products WHERE merchant_id = %s LIMIT 1", (run["merchant_id"],)
        ).fetchone()
        staged = run["staged"] or {}
        products = [CanonicalProduct.from_dict(p) for p in staged.get("products", [])]
        result = _plan_and_apply(
            conn, run_id, connector, run["merchant_id"],
            staged.get("location_id") or (location_id or {}).get("location_id"),
            run["mode"], products, [], fetched=run["fetched"], flags=list(run["flags"] or []),
            force=True, approved_by=approved_by, quarantined_before=run["quarantined"],
        )
        _finish_run(conn, run_id, "approved", started)
        return result


def reject_run(conninfo: str, run_id: int, rejected_by: str) -> None:
    with connect(conninfo) as conn:
        cur = conn.execute(
            """UPDATE ops.ingest_runs SET status = 'rejected', approved_by = %s, staged = NULL
               WHERE id = %s AND status = 'held'""",
            (rejected_by, run_id),
        )
        if cur.rowcount != 1:
            raise IngestError(f"run {run_id} is not held")




def _merchant_and_location(conn, merchant_slug: str, location_slug: str) -> tuple[int, int]:
    row = conn.execute(
        """SELECT m.id AS merchant_id, l.id AS location_id FROM merchant.merchants m
           JOIN merchant.locations l ON l.merchant_id = m.id
           WHERE m.slug = %s AND l.slug = %s""",
        (merchant_slug, location_slug),
    ).fetchone()
    if not row:
        raise IngestError(f"merchant {merchant_slug!r} with location {location_slug!r} not found (run `npm run db:seed`)")
    return row["merchant_id"], row["location_id"]


def _start_run(conn, merchant_id: int, connector: str, mode: str) -> int:
    run_id = conn.execute(
        "INSERT INTO ops.ingest_runs (merchant_id, connector, mode) VALUES (%s, %s, %s) RETURNING id",
        (merchant_id, connector, mode),
    ).fetchone()["id"]
    conn.commit()
    return run_id


def _finish_run(conn, run_id: int, status: str, started: float, error: str | None = None) -> None:
    conn.execute(
        """UPDATE ops.ingest_runs SET status = %s, error = %s, finished_at = now(), duration_ms = %s
           WHERE id = %s""",
        (status, error, int((time.monotonic() - started) * 1000), run_id),
    )
    conn.commit()


def _normalise(connector: SourceConnector, raw_records: list[dict[str, Any]]):
    products: list[CanonicalProduct] = []
    quarantine: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_records:
        try:
            p = connector.normalise(raw)
            if p.external_id in seen:
                raise QualityError("duplicate external_id in feed")
            seen.add(p.external_id)
            products.append(p)
        except QualityError as exc:
            ext = raw.get("external_id") or raw.get("name") if isinstance(raw, dict) else None
            quarantine.append({"external_id": str(ext) if ext else None, "reason": str(exc), "raw": raw})
    post = getattr(connector, "post_process", None)
    if post:
        products = post(products)
    return products, quarantine


def _ensure_taxonomy(conn) -> dict[tuple[str, str], int]:
    """Upserts the platform tree (no-op when unchanged) and returns (category, sub) → subcategory id."""
    for row in taxonomy_rows():
        conn.execute(
            """INSERT INTO catalog.categories (name, slug, sort_order) VALUES (%s, %s, %s)
               ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug, sort_order = EXCLUDED.sort_order
               WHERE categories.slug IS DISTINCT FROM EXCLUDED.slug
                  OR categories.sort_order IS DISTINCT FROM EXCLUDED.sort_order""",
            (row["category"], row["category_slug"], row["category_order"]),
        )
        conn.execute(
            """INSERT INTO catalog.subcategories (name, category_id, slug, sort_order)
               SELECT %s, id, %s, %s FROM catalog.categories WHERE name = %s
               ON CONFLICT (name, category_id) DO UPDATE SET slug = EXCLUDED.slug, sort_order = EXCLUDED.sort_order
               WHERE subcategories.slug IS DISTINCT FROM EXCLUDED.slug
                  OR subcategories.sort_order IS DISTINCT FROM EXCLUDED.sort_order""",
            (row["subcategory"], row["subcategory_slug"], row["subcategory_order"], row["category"]),
        )
    rows = conn.execute(
        """SELECT c.name AS category, s.name AS subcategory, s.id FROM catalog.subcategories s
           JOIN catalog.categories c ON c.id = s.category_id"""
    ).fetchall()
    return {(r["category"], r["subcategory"]): r["id"] for r in rows}


def _mappings(conn, merchant_id: int, connector: SourceConnector, subs: dict) -> dict[tuple[str, str], int | None]:
    for source_type, source_sub, category, sub in connector.default_mappings():
        conn.execute(
            """INSERT INTO catalog.category_mappings (merchant_id, source_type, source_subtype, subcategory_id)
               VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING""",
            (merchant_id, source_type, source_sub, subs[(category, sub)]),
        )
    rows = conn.execute(
        "SELECT source_type, source_subtype, subcategory_id FROM catalog.category_mappings WHERE merchant_id = %s",
        (merchant_id,),
    ).fetchall()
    return {(r["source_type"], r["source_subtype"]): r["subcategory_id"] for r in rows}


def _plan_and_apply(
    conn, run_id: int, connector: SourceConnector, merchant_id: int, location_id: int, mode: str,
    products: list[CanonicalProduct], quarantine: list[dict[str, Any]], *, fetched: int,
    flags: list[dict[str, Any]], force: bool, approved_by: str | None, quarantined_before: int = 0,
) -> RunResult:
    subs = _ensure_taxonomy(conn)
    mapping = _mappings(conn, merchant_id, connector, subs)
    uncategorised = subs[UNCATEGORISED]

    current = {
        r["external_id"]: r
        for r in conn.execute(
            """SELECT id, external_id, slug, source_hash, unit_price_cents, deleted_at
               FROM catalog.products WHERE merchant_id = %s""",
            (merchant_id,),
        ).fetchall()
    }
    plan = Plan(
        fetched=fetched,
        valid=len(products),
        quarantined=len(quarantine) + quarantined_before,
        active_before=sum(1 for r in current.values() if r["deleted_at"] is None),
        flags=flags,
    )

    writes: list[tuple[CanonicalProduct, dict[str, Any], dict[str, Any] | None]] = []
    unmapped: set[tuple[str, str]] = set()
    for p in products:
        key = (p.source_type, p.source_subtype)
        sub_id = mapping.get(key) if key in mapping else mapping.get((p.source_type, ""))
        if sub_id is None:
            sub_id = uncategorised
            if key not in unmapped:
                unmapped.add(key)
                plan.flags.append({"rule": "category_unmapped", "source_type": key[0], "source_subtype": key[1]})
        row = _row(p, connector, merchant_id, location_id, sub_id)
        before = current.get(p.external_id)
        if before is None:
            plan.inserts += 1
        elif before["source_hash"] != row["source_hash"] or before["deleted_at"] is not None:
            plan.updates += 1
            if before["unit_price_cents"] != p.unit_price_cents:
                plan.price_changes += 1
        else:
            plan.unchanged += 1
            continue
        plan.flags.extend(row_flags(p, before["unit_price_cents"] if before else None))
        writes.append((p, row, before))

    feed_ids = {p.external_id for p in products}
    to_deactivate = (
        [r for ext, r in current.items() if ext not in feed_ids and r["deleted_at"] is None]
        if mode == "full"
        else []
    )
    plan.deactivations = len(to_deactivate)

    last = conn.execute(
        """SELECT fetched FROM ops.ingest_runs
           WHERE merchant_id = %s AND connector = %s AND mode = %s AND status IN ('applied', 'approved')
           ORDER BY id DESC LIMIT 1""",
        (merchant_id, connector.name, mode),
    ).fetchone()
    found = [] if force else anomalies(plan, last["fetched"] if last else None, mode)

    result = RunResult(
        run_id=run_id,
        status="held" if found else ("approved" if approved_by else "applied"),
        fetched=fetched,
        quarantined=plan.quarantined,
        anomalies=found,
        flags=plan.flags,
    )
    _record_unmapped(conn, merchant_id, run_id, unmapped)
    _record_quarantine(conn, run_id, quarantine)

    if found:
        conn.execute(
            """UPDATE ops.ingest_runs SET fetched = %s, quarantined = %s, anomalies = %s, flags = %s,
                 staged = %s WHERE id = %s""",
            (fetched, plan.quarantined, Jsonb(found), Jsonb(plan.flags),
             Jsonb({"location_id": location_id, "products": [p.to_dict() for p in products]}), run_id),
        )
        conn.commit()
        log.warning("ingest run %s held: %s", run_id, found)
        return result

    changed_ids: list[str] = []
    for p, row, before in writes:
        _upsert_product(conn, row, before, run_id)
        _replace_promotions(conn, merchant_id, row["id"], p)
        changed_ids.append(row["id"])
    for r in to_deactivate:
        conn.execute(
            "UPDATE catalog.products SET deleted_at = now(), last_ingest_run_id = %s WHERE id = %s",
            (run_id, r["id"]),
        )
        changed_ids.append(r["id"])
    _emit_changes(conn, merchant_id, run_id, changed_ids)

    result.inserted, result.updated = plan.inserts, plan.updates
    result.unchanged, result.deactivated = plan.unchanged, plan.deactivations
    conn.execute(
        """UPDATE ops.ingest_runs SET fetched = %s, inserted = %s, updated = %s, unchanged = %s,
             deactivated = %s, quarantined = %s, anomalies = '[]', flags = %s, staged = NULL,
             approved_by = %s WHERE id = %s""",
        (fetched, result.inserted, result.updated, result.unchanged, result.deactivated,
         plan.quarantined, Jsonb(plan.flags), approved_by, run_id),
    )
    conn.commit()
    return result


def _row(p: CanonicalProduct, connector: SourceConnector, merchant_id: int, location_id: int, sub_id: int) -> dict[str, Any]:
    row = {
        "id": f"{connector.id_prefix}{p.external_id}",
        "external_id": p.external_id,
        "merchant_id": merchant_id,
        "location_id": location_id,
        "subcategory_id": sub_id,
        "slug": product_slug(p.name, merchant_id, p.external_id),
        "blocked_reason": blocked_reason(p),
        **{k: v for k, v in p.to_dict().items() if k != "promotions"},
        "images": p.images or [PLACEHOLDER_IMAGE],
        "promotions": sorted((pr.__dict__ for pr in p.promotions), key=lambda d: d["external_id"]),
    }
    row["source_hash"] = source_hash(row)
    return row


PRODUCT_COLUMNS = [
    "id", "external_id", "merchant_id", "location_id", "subcategory_id", "slug", "name", "brand", "upc",
    "description", "unit_price_cents", "sku", "availability", "images", "pricing_model", "unit", "sell_by",
    "estimated_weight_lb", "weight_step_lb", "min_weight_lb", "tax_code", "deposit_cents", "min_qty",
    "max_qty", "available_days", "organic", "dietary_claims", "attributes", "nutrition_label", "disclaimer",
    "is_alcohol", "pickup_only", "blocked_reason", "source_type", "source_subtype",
    "source_virtual_category", "source_status", "source_hash",
]
CASTS = {"available_days": "::smallint[]", "estimated_weight_lb": "::numeric",
         "weight_step_lb": "::numeric", "min_weight_lb": "::numeric"}


def _upsert_product(conn, row: dict[str, Any], before: dict[str, Any] | None, run_id: int) -> None:
    values = {**row, "attributes": Jsonb(row["attributes"])}
    cols = ", ".join(PRODUCT_COLUMNS)
    placeholders = ", ".join(f"%({c})s{CASTS.get(c, '')}" for c in PRODUCT_COLUMNS)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in PRODUCT_COLUMNS if c not in ("id", "merchant_id", "external_id"))
    conn.execute(
        f"""INSERT INTO catalog.products ({cols}, currency, last_ingest_run_id, deleted_at)
            VALUES ({placeholders}, 'CAD', %(run_id)s, NULL)
            ON CONFLICT (id) DO UPDATE SET {updates}, last_ingest_run_id = EXCLUDED.last_ingest_run_id,
              deleted_at = NULL""",
        {**values, "run_id": run_id},
    )
    if before and before["slug"] and before["slug"] != row["slug"]:
        conn.execute(
            """INSERT INTO catalog.product_slug_history (slug, product_id) VALUES (%s, %s)
               ON CONFLICT (slug) DO UPDATE SET product_id = EXCLUDED.product_id, retired_at = now()""",
            (before["slug"], row["id"]),
        )
        conn.execute("DELETE FROM catalog.product_slug_history WHERE slug = %s", (row["slug"],))


def _replace_promotions(conn, merchant_id: int, product_id: str, p: CanonicalProduct) -> None:
    """Upstream promotions have no dates: active while present, ended when absent (CATALOG §3.1)."""
    keep = [pr.external_id for pr in p.promotions]
    conn.execute(
        """DELETE FROM catalog.promotions WHERE product_id = %s
           AND (external_id IS NULL OR NOT (external_id = ANY(%s::text[])))""",
        (product_id, keep),
    )
    for pr in p.promotions:
        conn.execute(
            """INSERT INTO catalog.promotions
                 (merchant_id, external_id, product_id, kind, sale_price_cents, label, starts_at, ends_at, source_hash)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (merchant_id, product_id, external_id) DO UPDATE SET
                 kind = EXCLUDED.kind, sale_price_cents = EXCLUDED.sale_price_cents, label = EXCLUDED.label,
                 starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, source_hash = EXCLUDED.source_hash
               WHERE promotions.source_hash IS DISTINCT FROM EXCLUDED.source_hash""",
            (merchant_id, pr.external_id, product_id, pr.kind, pr.sale_price_cents, pr.label,
             pr.starts_at, pr.ends_at, source_hash(pr.__dict__)),
        )


def _emit_changes(conn, merchant_id: int, run_id: int, product_ids: list[str]) -> None:
    """Outbox events in the same transaction (ADR-0008): search sync and storefront revalidation."""
    if not product_ids:
        return
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO ops.outbox (topic, key, payload) VALUES ('product.changed', %s, %s)",
            [(pid, Jsonb({"productId": pid, "reason": "ingest", "runId": run_id})) for pid in product_ids],
        )
    conn.execute(
        "INSERT INTO ops.outbox (topic, key, payload) VALUES ('catalog.ingested', %s, %s)",
        (str(merchant_id), Jsonb({"merchantId": merchant_id, "runId": run_id, "changed": len(product_ids)})),
    )


def _record_unmapped(conn, merchant_id: int, run_id: int, unmapped: set[tuple[str, str]]) -> None:
    for source_type, source_sub in unmapped:
        conn.execute(
            """INSERT INTO catalog.category_mappings
                 (merchant_id, source_type, source_subtype, subcategory_id, status, first_seen_run)
               VALUES (%s, %s, %s, NULL, 'unmapped', %s) ON CONFLICT DO NOTHING""",
            (merchant_id, source_type, source_sub, run_id),
        )


def _record_quarantine(conn, run_id: int, quarantine: list[dict[str, Any]]) -> None:
    if not quarantine:
        return
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO ops.ingest_quarantine (run_id, external_id, reason, raw) VALUES (%s, %s, %s, %s)",
            [(run_id, q["external_id"], q["reason"], Jsonb(q["raw"])) for q in quarantine],
        )
