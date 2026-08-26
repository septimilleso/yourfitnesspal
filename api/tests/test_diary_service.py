"""Unit tests for the pure totals-computation math in `app/services/diary.py`.

These do NOT touch the database -- `compute_day_totals`/`compute_week_totals`
take plain duck-typed objects, so the summation/scaling logic gets real
RED -> GREEN coverage even in an environment with no Postgres available.
"""

from dataclasses import dataclass

from app.models.diary import Meal
from app.services.diary import (
    NUTRIMENT_FIELDS,
    add_totals,
    compute_day_totals,
    compute_week_totals,
    scale_nutriments,
    zero_totals,
)

NUTRIMENTS_100G = {
    "kcal": 200.0,
    "protein_g": 20.0,
    "carbs_g": 10.0,
    "sugars_g": 5.0,
    "fat_g": 8.0,
    "sat_fat_g": 2.0,
    "fiber_g": 1.0,
    "salt_g": 0.5,
}


@dataclass
class FakeEntry:
    """Duck-typed stand-in for a `DiaryEntry` row -- only the attributes
    `compute_day_totals` actually reads."""

    meal: Meal
    grams: float
    nutriments_snapshot: dict


# --- scale_nutriments / add_totals / zero_totals ----------------------------


def test_zero_totals_has_all_eight_fields_at_zero():
    totals = zero_totals()
    assert set(totals) == set(NUTRIMENT_FIELDS)
    assert all(value == 0.0 for value in totals.values())


def test_scale_nutriments_at_100g_is_identity():
    scaled = scale_nutriments(NUTRIMENTS_100G, 100)
    assert scaled == NUTRIMENTS_100G


def test_scale_nutriments_scales_proportionally():
    scaled = scale_nutriments(NUTRIMENTS_100G, 50)
    assert scaled["kcal"] == 100.0
    assert scaled["protein_g"] == 10.0
    assert scaled["salt_g"] == 0.25


def test_scale_nutriments_handles_missing_field_as_zero():
    partial = {"kcal": 200.0}
    scaled = scale_nutriments(partial, 100)
    assert scaled["protein_g"] == 0.0


def test_add_totals_sums_each_field():
    a = {field: 1.0 for field in NUTRIMENT_FIELDS}
    b = {field: 2.0 for field in NUTRIMENT_FIELDS}
    result = add_totals(a, b)
    assert all(result[field] == 3.0 for field in NUTRIMENT_FIELDS)


# --- compute_day_totals ------------------------------------------------------


def test_compute_day_totals_empty_entries_is_zero():
    result = compute_day_totals([])
    assert result["by_meal"] == {}
    assert result["total"] == zero_totals()


def test_compute_day_totals_sums_single_entry_scaled_by_grams():
    entries = [FakeEntry(meal=Meal.breakfast, grams=50, nutriments_snapshot=NUTRIMENTS_100G)]
    result = compute_day_totals(entries)
    assert result["total"]["kcal"] == 100.0
    assert result["by_meal"]["breakfast"]["kcal"] == 100.0


def test_compute_day_totals_groups_by_meal_and_sums_day_total():
    entries = [
        FakeEntry(meal=Meal.breakfast, grams=100, nutriments_snapshot=NUTRIMENTS_100G),
        FakeEntry(meal=Meal.breakfast, grams=100, nutriments_snapshot=NUTRIMENTS_100G),
        FakeEntry(meal=Meal.lunch, grams=200, nutriments_snapshot=NUTRIMENTS_100G),
    ]
    result = compute_day_totals(entries)

    assert result["by_meal"]["breakfast"]["kcal"] == 400.0  # 2 * 200
    assert result["by_meal"]["lunch"]["kcal"] == 400.0  # 1 * 400 (200g @ 200kcal/100g)
    assert result["total"]["kcal"] == 800.0
    assert "dinner" not in result["by_meal"]
    assert "snack" not in result["by_meal"]


def test_compute_day_totals_grams_change_recomputes_total_snapshot_fixed():
    """Mirrors the PATCH-grams scenario: same snapshot, different grams ->
    different scaled total. The snapshot dict itself is never mutated."""
    entry = FakeEntry(meal=Meal.dinner, grams=100, nutriments_snapshot=NUTRIMENTS_100G)
    before = compute_day_totals([entry])["total"]["kcal"]
    assert before == 200.0

    entry.grams = 300  # simulates a PATCH changing grams, snapshot untouched
    after = compute_day_totals([entry])["total"]["kcal"]
    assert after == 600.0
    assert entry.nutriments_snapshot == NUTRIMENTS_100G  # snapshot unchanged


def test_compute_day_totals_delete_removes_entry_contribution():
    entries = [
        FakeEntry(meal=Meal.snack, grams=100, nutriments_snapshot=NUTRIMENTS_100G),
        FakeEntry(meal=Meal.snack, grams=100, nutriments_snapshot=NUTRIMENTS_100G),
    ]
    before = compute_day_totals(entries)["total"]["kcal"]
    assert before == 400.0

    remaining = entries[:1]  # simulates a DELETE
    after = compute_day_totals(remaining)["total"]["kcal"]
    assert after == 200.0


# --- compute_week_totals -----------------------------------------------------


def test_compute_week_totals_returns_meal_less_total_per_day():
    day1 = [FakeEntry(meal=Meal.breakfast, grams=100, nutriments_snapshot=NUTRIMENTS_100G)]
    day2 = [
        FakeEntry(meal=Meal.lunch, grams=100, nutriments_snapshot=NUTRIMENTS_100G),
        FakeEntry(meal=Meal.dinner, grams=100, nutriments_snapshot=NUTRIMENTS_100G),
    ]
    day3: list[FakeEntry] = []

    result = compute_week_totals({"d1": day1, "d2": day2, "d3": day3})

    assert result["d1"]["kcal"] == 200.0
    assert result["d2"]["kcal"] == 400.0
    assert result["d3"] == zero_totals()
    # meal-less: no "by_meal" key leaks into the per-day totals
    assert "by_meal" not in result["d1"]
