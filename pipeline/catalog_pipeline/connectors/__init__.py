"""Connector registry. `fixture` is the default; everything else is opt-in."""
from __future__ import annotations

from collections.abc import Mapping

from .base import Mode, SourceConnector
from .fixture import FixtureConnector
from .homesome_api import ConnectorDisabled, HomesomeApiConnector
from .scraped_json import ScrapedJsonConnector

CONNECTORS = {
    "fixture": FixtureConnector,
    "homesome_api": HomesomeApiConnector,
    "scraped_json": ScrapedJsonConnector,
}


def get_connector(name: str, env: Mapping[str, str] | None = None) -> SourceConnector:
    if name == "fixture":
        path = (env or {}).get("CATALOG_FIXTURE_PATH")
        # Demo/test knob (G5-14): a partial feed, e.g. 0.5, to show the anomaly guard holding a run
        fraction = (env or {}).get("CATALOG_FIXTURE_FRACTION")
        return FixtureConnector(path, fraction=float(fraction) if fraction else None)
    if name == "scraped_json":
        return ScrapedJsonConnector((env or {}).get("SCRAPED_JSON_PATH"))
    if name == "homesome_api":
        return HomesomeApiConnector(env)
    raise ValueError(f"unknown connector {name!r} (known: {', '.join(CONNECTORS)})")


__all__ = ["CONNECTORS", "ConnectorDisabled", "Mode", "SourceConnector", "get_connector"]
