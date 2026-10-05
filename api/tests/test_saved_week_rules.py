from dataclasses import dataclass
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from app.models.diary import Meal
from app.services.diary import plan_copy
from app.services.errors import Invalid
from app.services.saved_week_rules import (
    ANCHOR_MONDAY,
    clean_name,
    ensure_monday,
    item_day_totals,
    normalize_days,
    plan_apply,
    week_stats,
)

NUTRIMENTS = {
    "kcal": 200.0,
    "protein_g": 20.0,
    "carbs_g": 10.0,
    "sugars_g": 5.0,
    "fat_g": 8.0,
    "sat_fat_g": 2.0,
    "fiber_g": 1.0,
    "salt_g": 0.5,
}
CURRENT_NUTRIMENTS = {**NUTRIMENTS, "kcal": 350.0}


@dataclass
class FakeSavedItem:
    day_index: int
    meal: Meal
    food_id: int
    grams: float
    portion_label: str | None
    position: int
    food: SimpleNamespace


def item(day_index, meal=Meal.breakfast, food_id=1, grams=100, food_nutriments=None):
    return FakeSavedItem(
        day_index=day_index,
        meal=meal,
        food_id=food_id,
        grams=grams,
        portion_label="1 porzione",
        position=0,
        food=SimpleNamespace(nutriments=food_nutriments or NUTRIMENTS),
    )


class TestCleanName:
    def test_strips_outer_whitespace(self):
        assert clean_name("  Dieta A  ") == "Dieta A"

    def test_rejects_empty_name(self):
        with pytest.raises(Invalid):
            clean_name(" \t ")

    def test_accepts_100_characters(self):
        assert clean_name("x" * 100) == "x" * 100

    def test_rejects_101_characters(self):
        with pytest.raises(Invalid):
            clean_name("x" * 101)


class TestEnsureMonday:
    def test_accepts_monday(self):
        assert ensure_monday(date(2026, 10, 5)) is None

    def test_rejects_tuesday(self):
        with pytest.raises(Invalid):
            ensure_monday(date(2026, 10, 6))


class TestNormalizeDays:
    def test_none_means_all_weekdays(self):
        assert normalize_days(None) == list(range(7))

    @pytest.mark.parametrize("days", [[], [7], [-1], [1, 7]])
    def test_rejects_empty_or_out_of_range_days(self, days):
        with pytest.raises(Invalid):
            normalize_days(days)

    def test_deduplicates_and_sorts_days(self):
        assert normalize_days([3, 1, 3, 0]) == [0, 1, 3]


class TestItemDayTotals:
    def test_totals_are_grouped_by_saved_day_and_use_current_food_nutrients(self):
        totals = item_day_totals(
            [
                item(0, grams=50, food_nutriments=CURRENT_NUTRIMENTS),
                item(0, Meal.lunch, food_id=2, grams=100),
                item(3, Meal.dinner, grams=25),
            ]
        )

        assert totals[0]["total"]["kcal"] == 375.0
        assert totals[0]["total"]["protein_g"] == 30.0
        assert totals[3]["total"]["kcal"] == 50.0
        assert 1 not in totals

    def test_empty_items_returns_no_day_totals(self):
        assert item_day_totals([]) == {}


class TestWeekStats:
    def test_counts_items_and_averages_kcal_only_over_nonempty_days(self):
        entries_count, avg_kcal = week_stats(
            [
                item(0, grams=100),
                item(0, Meal.lunch, food_id=2, grams=50),
                item(3, Meal.dinner, grams=100),
            ]
        )

        assert entries_count == 3
        assert avg_kcal == 250.0

    def test_empty_week_has_zero_count_and_average(self):
        assert week_stats([]) == (0, 0.0)


class TestPlanApply:
    def test_selected_days_map_positionally_and_filter_meals(self):
        items = [
            item(1, Meal.breakfast, food_id=11),
            item(1, Meal.lunch, food_id=12),
            item(3, Meal.dinner, food_id=13),
        ]
        plan = plan_apply(
            items,
            [1, 3],
            date(2026, 10, 12),
            [Meal.lunch, Meal.dinner],
            "append",
        )

        assert [row["date"] for row in plan["days"]] == [date(2026, 10, 12), date(2026, 10, 13)]
        assert [row["food_id"] for row in plan["inserts"]] == [12, 13]
        assert plan["deletes"] == []

    def test_replace_deletes_destination_for_saved_day_without_entries(self):
        plan = plan_apply([], [2], date(2026, 10, 12), None, "replace")

        assert plan["deletes"] == [(date(2026, 10, 12), set(Meal))]
        assert plan["days"] == [{"date": date(2026, 10, 12), "entries_created": 0}]

    def test_insert_snapshot_comes_from_current_food_nutrients(self):
        plan = plan_apply(
            [item(0, food_nutriments=CURRENT_NUTRIMENTS)],
            [0],
            date(2026, 10, 12),
            None,
            "append",
        )

        assert plan["inserts"][0]["nutriments_snapshot"] == CURRENT_NUTRIMENTS
        assert plan["inserts"][0]["nutriments_snapshot"] != NUTRIMENTS

    def test_matches_direct_plan_copy_for_same_source_rows(self):
        saved_items = [item(1, food_id=11), item(3, Meal.dinner, food_id=13)]
        selected_days = [1, 3]
        target_start = date(2026, 10, 12)
        result = plan_apply(saved_items, selected_days, target_start, None, "replace")

        expected = plan_copy(
            source_dates=[ANCHOR_MONDAY + timedelta(days=day) for day in selected_days],
            target_start=target_start,
            meals=None,
            mode="replace",
            entries_by_source_date={
                ANCHOR_MONDAY + timedelta(days=day): [
                    SimpleNamespace(
                        food_id=entry.food_id,
                        meal=entry.meal,
                        grams=entry.grams,
                        portion_label=entry.portion_label,
                        nutriments_snapshot=entry.food.nutriments,
                    )
                    for entry in saved_items
                    if entry.day_index == day
                ]
                for day in selected_days
            },
        )

        assert result["days"] == expected["days"]
        assert result["deletes"] == expected["deletes"]
