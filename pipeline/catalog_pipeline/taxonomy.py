"""The platform taxonomy (CATALOG §7). The category tree is ours and versioned here; each merchant's
source categories are mapped onto it through catalog.category_mappings.
"""
from __future__ import annotations

from .canonical import slugify

UNCATEGORISED = ("Uncategorised", "Uncategorised")
GENERAL = "General"

TAXONOMY: list[tuple[str, list[str]]] = [
    ("Produce", ["Fresh Fruit", "Fresh Vegetables"]),
    ("Meat & Seafood", ["Beef", "Seafood"]),
    ("Dairy & Eggs", ["Eggs", "Cheese", "Milk & Cream"]),
    ("Bakery", ["Breads", "Cakes & Pastries"]),
    ("Prepared Meals", ["Entrees", "Sushi"]),
    ("Deli", []),
    ("Beverages", ["Juice", "Soft Drinks"]),
    ("Snacks & Treats", ["Chips", "Chocolate & Candy", "Cookies"]),
    ("Dry Goods & Baking", ["Pasta & Grains", "Baking"]),
    ("Canned & Jarred", []),
    ("Condiments & Sauces", []),
    ("Frozen Specialties", []),
    ("Health & Baby Care", []),
    ("Household & Cleaning", []),
    ("Giftware & Decor", []),
    ("Miscellaneous", []),
]


def taxonomy_rows() -> list[dict]:
    """Flattened tree with slugs and sort order, Uncategorised last."""
    rows = []
    for ci, (category, subs) in enumerate(TAXONOMY):
        for si, sub in enumerate([*subs, GENERAL]):
            rows.append(
                {
                    "category": category,
                    "category_slug": slugify(category),
                    "category_order": ci,
                    "subcategory": sub,
                    "subcategory_slug": slugify(sub),
                    "subcategory_order": si,
                }
            )
    rows.append(
        {
            "category": UNCATEGORISED[0],
            "category_slug": "uncategorised",
            "category_order": 999,
            "subcategory": UNCATEGORISED[1],
            "subcategory_slug": "uncategorised",
            "subcategory_order": 0,
        }
    )
    return rows


def identity_mappings() -> list[tuple[str, str, str, str]]:
    """source (type, subtype) → platform (category, subcategory) where the names already match."""
    return [(c, s, c, s) for c, subs in TAXONOMY for s in subs]


def type_level_mappings() -> list[tuple[str, str, str, str]]:
    """source type (any subtype) → the category's General subcategory."""
    return [(c, "", c, GENERAL) for c, _ in TAXONOMY]
