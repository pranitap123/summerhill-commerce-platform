"""Pipeline configuration, read from the environment only (no credentials in code)."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    connector: str
    merchant_slug: str
    location_slug: str


def settings() -> Settings:
    return Settings(
        database_url=os.environ.get("INGEST_DATABASE_URL") or None,
        connector=os.environ.get("CATALOG_CONNECTOR", "fixture"),
        merchant_slug=os.environ.get("CATALOG_MERCHANT_SLUG", "demo-market"),
        location_slug=os.environ.get("CATALOG_LOCATION_SLUG", "downtown"),
    )
