"""Pushes catalogue changes into Elasticsearch after an ingest run (Stage 2).

Writes straight to the live search alias, in bulk, as partial upserts: a product that is already
indexed keeps its popularity, which the pipeline's role cannot read (it lives with the orders). The
index itself (mapping, analysers, alias swaps) is created by the web app's `search:rebuild`, so
this step only syncs; if there is no index yet it says so and does nothing. The web worker's
outbox sync keeps running and is idempotent, so both paths can write the same product.

Environment: ELASTICSEARCH_URL (default http://localhost:9200), SEARCH_INDEX_ALIAS (catalog-products).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import psycopg
import requests
from psycopg.rows import dict_row

TIMEOUT = (5, 60)
BATCH = 500

# Same projection as the web app's catalog/projection.ts, minus popularity and the order tables.
SELECT = """
SELECT v.id, v.slug, v.merchant_id, v.merchant_slug, v.name, v.brand, v.description,
  v.category, v.category_slug, v.subcategory, v.subcategory_slug, v.organic, v.dietary_claims,
  v.pricing_model, v.unit, v.unit_price_cents, v.tax_code, v.availability, v.images, v.updated_at,
  v.hidden_until,
  (v.source_status = 'listed' AND v.blocked_reason IS NULL AND NOT v.hidden
    AND (SELECT storefront_visible FROM merchant.merchants m WHERE m.id = v.merchant_id)) AS listed,
  COALESCE((SELECT json_agg(json_build_object('sale_price_cents', pr.sale_price_cents,
              'starts_at', pr.starts_at, 'ends_at', pr.ends_at))
            FROM catalog.promotions pr WHERE pr.product_id = v.id), '[]'::json) AS promotions
FROM catalog.product_view v
WHERE v.deleted_at IS NULL
"""


def _ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def effective_price(unit_price_cents: int, promotions: list[dict[str, Any]], now: datetime) -> int:
    """The lowest active promotion price, else the regular price (CATALOG §3.1)."""
    best = unit_price_cents
    for p in promotions:
        starts, ends = _ts(p.get("starts_at")), _ts(p.get("ends_at"))
        active = (starts is None or starts <= now) and (ends is None or ends > now)
        if active and int(p["sale_price_cents"]) < best:
            best = int(p["sale_price_cents"])
    return best


def to_document(row: dict[str, Any], now: datetime) -> dict[str, Any]:
    unit_price = int(row["unit_price_cents"])
    effective = effective_price(unit_price, row["promotions"], now)
    hidden = _ts(row["hidden_until"])
    return {
        "id": row["id"],
        "slug": row["slug"] or row["id"],
        "merchantId": int(row["merchant_id"]),
        "merchantSlug": row["merchant_slug"],
        "name": row["name"],
        "brand": row["brand"],
        "description": row["description"],
        "category": row["category"],
        "categorySlug": row["category_slug"],
        "subcategory": row["subcategory"],
        "subcategorySlug": row["subcategory_slug"],
        "organic": row["organic"],
        "dietaryClaims": row["dietary_claims"],
        "pricingModel": row["pricing_model"],
        "unit": row["unit"],
        "effectivePriceCents": effective,
        "onSale": effective < unit_price,
        "taxCode": row["tax_code"],
        "inStock": row["availability"] == "in_stock",
        "listed": bool(row["listed"]),
        "hiddenUntil": _iso(hidden) if hidden else None,
        "image": (row["images"] or [None])[0],
        "updatedAt": _iso(_ts(row["updated_at"])),
    }


def _bulk(session: requests.Session, es_url: str, alias: str, lines: list[dict[str, Any]]) -> None:
    body = "\n".join(json.dumps(line, separators=(",", ":")) for line in lines) + "\n"
    res = session.post(
        f"{es_url}/{alias}/_bulk",
        data=body.encode("utf-8"),
        headers={"content-type": "application/x-ndjson"},
        timeout=TIMEOUT,
    )
    res.raise_for_status()
    payload = res.json()
    if payload.get("errors"):
        failed = []
        for item in payload["items"]:
            action, op = next(iter(item.items()))
            # Deleting a document that was never indexed is fine
            if op.get("error") and not (action == "delete" and op.get("status") == 404):
                failed.append(item)
        if failed:
            raise RuntimeError(f"bulk indexing failed for {len(failed)} item(s): {json.dumps(failed[0])}")


def sync_search(
    database_url: str,
    es_url: str = "http://localhost:9200",
    alias: str = "catalog-products",
    since: datetime | None = None,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Upserts products changed since `since` (all when None); removes deleted ones."""
    session = session or requests.Session()
    es_url = es_url.rstrip("/")
    if session.head(f"{es_url}/_alias/{alias}", timeout=TIMEOUT).status_code != 200:
        return {"status": "skipped", "reason": f"no search index behind alias {alias!r}: run `npm run search:rebuild`"}
    now = datetime.now(timezone.utc)
    upserted = deleted = 0
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        where, params = "", []
        if since is not None:
            where = (
                " AND (v.updated_at >= %s OR EXISTS (SELECT 1 FROM catalog.promotions p"
                " WHERE p.product_id = v.id AND p.updated_at >= %s))"
            )
            params = [since, since]
        rows = conn.execute(f"{SELECT}{where} ORDER BY v.id", params).fetchall()
        for start in range(0, len(rows), BATCH):
            lines: list[dict[str, Any]] = []
            for row in rows[start : start + BATCH]:
                doc = to_document(row, now)
                lines.append({"update": {"_id": doc["id"]}})
                lines.append({"doc": doc, "doc_as_upsert": True})
            _bulk(session, es_url, alias, lines)
            upserted += len(lines) // 2
        gone_sql = "SELECT id FROM catalog.product_view WHERE deleted_at IS NOT NULL"
        gone = conn.execute(gone_sql + (" AND updated_at >= %s" if since is not None else ""), [since] if since is not None else []).fetchall()
        if gone:
            _bulk(session, es_url, alias, [{"delete": {"_id": r["id"]}} for r in gone])
            deleted = len(gone)
    if upserted or deleted:
        session.post(f"{es_url}/{alias}/_refresh", timeout=TIMEOUT)
    return {"status": "synced", "alias": alias, "upserted": upserted, "deleted": deleted}
