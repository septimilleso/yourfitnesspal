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

from collections.abc import Iterable, Mapping, Sequence
from datetime import date, timedelta
from typing import Any

from app.models.diary import Meal

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


def plan_copy(
    *,
    source_dates: Sequence[date],
    target_start: date,
    meals: Sequence[Any] | None,
    mode: str,
    entries_by_source_date: Mapping[date, Iterable[Any]],
) -> dict[str, Any]:
    """Pure copy-planning for `POST /api/diary/copy`.

    Decoupled from the DB/session on purpose so the trickiest part of the
    task -- the overlap case where a target date is also a source date under
    `mode == "replace"` -- gets real, DB-free test coverage. Mirrors how
    `compute_day_totals` above stays pure.

    `entries_by_source_date` must map each of `source_dates` to that day's
    already-fetched entries (duck-typed: `.food_id`, `.meal`, `.grams`,
    `.portion_label`, `.nutriments_snapshot`), fetched from the DB *before*
    any deletes are issued -- this is what makes the overlap case correct:
    a target date's original entries are captured in memory before they'd
    be wiped by a `replace` on that same date acting as someone else's
    target.

    `source_dates` is sorted ascending and `source_dates[i]` maps to
    `target_start + i` days -- i.e. the mapping is positional, not by value,
    so duplicate source dates each get their own target slot.

    Returns `{"deletes": [(target_date, meal_set)], "inserts": [...],
    "days": [{"date": target_date, "entries_created": int}]}`. Callers MUST
    execute all `deletes` before any `inserts` (that ordering, plus the
    read-before-delete fetch above, is what makes replace-mode overlap
    correct -- see the task brief).

    Each insert dict's `nutriments_snapshot` is a fresh `dict(...)` copy of
    the source entry's existing snapshot, copied verbatim -- never
    re-derived from a `Food` row -- so history survives even if the
    underlying food's nutriments have since changed.
    """
    sorted_sources = sorted(source_dates)
    meal_set = set(meals) if meals is not None else set(Meal)

    deletes: list[tuple[date, set]] = []
    inserts: list[dict[str, Any]] = []
    days: list[dict[str, Any]] = []

    for i, src_date in enumerate(sorted_sources):
        target_date = target_start + timedelta(days=i)
        if mode == "replace":
            deletes.append((target_date, meal_set))

        entries_created = 0
        for entry in entries_by_source_date.get(src_date, []):
            if entry.meal not in meal_set:
                continue
            inserts.append(
                {
                    "date": target_date,
                    "food_id": entry.food_id,
                    "meal": entry.meal,
                    "grams": entry.grams,
                    "portion_label": entry.portion_label,
                    "nutriments_snapshot": dict(entry.nutriments_snapshot),
                }
            )
            entries_created += 1
        days.append({"date": target_date, "entries_created": entries_created})

    return {"deletes": deletes, "inserts": inserts, "days": days}
