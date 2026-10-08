"""Connector interface (CATALOG §2). Onboarding a merchant means writing one of these, not changing
the catalogue model.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Literal, Protocol

from ..canonical import CanonicalProduct

Mode = Literal["full", "delta"]


class SourceConnector(Protocol):
    name: str
    id_prefix: str

    def extract(self, mode: Mode) -> Iterable[dict[str, Any]]:
        """Raw source records. Must not write anything."""
        ...

    def normalise(self, raw: dict[str, Any]) -> CanonicalProduct:
        """One raw record → canonical product; raises QualityError for bad records."""
        ...

    def default_mappings(self) -> list[tuple[str, str, str, str]]:
        """(source_type, source_subtype, category, subcategory) rows prefilled for a new merchant."""
        ...
