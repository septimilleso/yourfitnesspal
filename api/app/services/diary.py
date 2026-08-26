"""Pure-function totals computation for the diary.

Deliberately decoupled from the DB/ORM: every function here takes plain data
(iterables of duck-typed objects exposing `.meal`, `.grams`,
`.nutriments_snapshot`, or plain dicts of that shape) and returns plain
dicts. This lets the summation/scaling math be unit-tested with in-memory
objects, no Postgres required -- the router (`app/routers/diary.py`) is the
only place that touches the DB, and it just calls these functions with the
`DiaryEntry` rows it loaded.

`nutriments_snapshot` is stored UNSCALED (the food's full per-100g
nutriment dict, copied verbatim at entry-creation time) -- see
`app/routers/diary.py`'s `create_entry`. All scaling by `grams/100` happens
here, at read time, which is what lets a later edit to `grams` change
computed totals without ever touching the stored snapshot.
"""

from collections.abc import Iterable, Mapping
from typing import Any

# The 8 per-100g nutriment fields `Food.nutriments` / `DiaryEntry.nutriments_snapshot` store.
NUTRIMENT_FIELDS = (
    "kcal",
    "protein_g",
    "carbs_g",
    "sugars_g",
    "fat_g",
    "sat_fat_g",
    "fiber_g",
    "salt_g",
)


def zero_totals() -> dict[str, float]:
    return {field: 0.0 for field in NUTRIMENT_FIELDS}


def scale_nutriments(nutriments: Mapping[str, Any], grams: float) -> dict[str, float]:
    """Scale a per-100g nutriment dict to `grams` grams."""
    factor = float(grams) / 100.0
    return {field: float(nutriments.get(field, 0) or 0) * factor for field in NUTRIMENT_FIELDS}


def add_totals(a: Mapping[str, float], b: Mapping[str, float]) -> dict[str, float]:
    return {field: a.get(field, 0.0) + b.get(field, 0.0) for field in NUTRIMENT_FIELDS}


def _meal_key(meal: Any) -> str:
    return meal.value if hasattr(meal, "value") else meal


def compute_day_totals(entries: Iterable[Any]) -> dict[str, Any]:
    """Sum nutriments (scaled by `grams/100`) across a day's entries.

    Each entry must expose `.meal`, `.grams`, `.nutriments_snapshot`
    (a `DiaryEntry` row satisfies this; so does any duck-typed stand-in used
    in tests).

    Returns `{"by_meal": {meal_value: totals_dict}, "total": totals_dict}`.
    """
    by_meal: dict[str, dict[str, float]] = {}
    total = zero_totals()
    for entry in entries:
        key = _meal_key(entry.meal)
        scaled = scale_nutriments(entry.nutriments_snapshot, entry.grams)
        by_meal[key] = add_totals(by_meal.get(key, zero_totals()), scaled)
        total = add_totals(total, scaled)
    return {"by_meal": by_meal, "total": total}


def compute_week_totals(entries_by_date: Mapping[Any, Iterable[Any]]) -> dict[Any, dict[str, float]]:
    """Per-day (meal-less) totals for a week. `entries_by_date` maps each of
    the 7 dates to that day's entries (an empty list is fine for days with
    no entries logged)."""
    return {day: compute_day_totals(entries)["total"] for day, entries in entries_by_date.items()}
