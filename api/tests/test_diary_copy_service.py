"""Unit tests for `plan_copy` in `app/services/diary.py` -- the pure
copy-planning logic behind `POST /api/diary/copy`.

Deliberately DB-free (unlike `test_diary_copy.py`, which needs a live
Postgres and is the endpoint-level counterpart of this file) -- mirrors how
`test_diary_service.py` covers `compute_day_totals` without touching the
database. This is what gets real RED -> GREEN coverage of the trickiest part
of Task 7: sorting source dates, mapping them onto consecutive target dates,
and getting delete-before-insert ordering right for the overlapping
source/target case under `mode="replace"`.
"""

from dataclasses import dataclass
from datetime import date

from app.models.diary import Meal
from app.services.diary import plan_copy

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

CHANGED_NUTRIMENTS = {
    "kcal": 999.0,
    "protein_g": 1.0,
    "carbs_g": 1.0,
    "sugars_g": 1.0,
    "fat_g": 1.0,
    "sat_fat_g": 1.0,
    "fiber_g": 1.0,
    "salt_g": 1.0,
}


@dataclass
class FakeEntry:
    """Duck-typed stand-in for a `DiaryEntry` row -- only the attributes
    `plan_copy` actually reads."""

    food_id: int
    meal: Meal
    grams: float
    portion_label: str | None
    nutriments_snapshot: dict


class TestPlanCopySorting:
    def test_single_source_maps_to_target_start(self):
        entries = {date(2026, 1, 5): [FakeEntry(1, Meal.breakfast, 100, None, NUTRIMENTS)]}
        plan = plan_copy(
            source_dates=[date(2026, 1, 5)],
            target_start=date(2026, 1, 12),
            meals=None,
            mode="append",
            entries_by_source_date=entries,
        )
        assert plan["days"] == [{"date": date(2026, 1, 12), "entries_created": 1}]
        assert len(plan["inserts"]) == 1
        assert plan["inserts"][0]["date"] == date(2026, 1, 12)

    def test_unsorted_source_dates_are_sorted_ascending_before_mapping(self):
        """source_dates given out of order (e.g. [tue, mon]) must still map
        mon -> target_start, tue -> target_start+1 -- positional mapping is
        by *sorted* order, not input order."""
        mon = date(2026, 1, 5)
        tue = date(2026, 1, 6)
        entries = {
            mon: [FakeEntry(1, Meal.breakfast, 100, None, NUTRIMENTS)],
            tue: [FakeEntry(2, Meal.lunch, 100, None, NUTRIMENTS)],
        }
        plan = plan_copy(
            source_dates=[tue, mon],  # deliberately reversed
            target_start=date(2026, 1, 12),
            meals=None,
            mode="append",
            entries_by_source_date=entries,
        )
        assert plan["days"] == [
            {"date": date(2026, 1, 12), "entries_created": 1},
            {"date": date(2026, 1, 13), "entries_created": 1},
        ]
        by_target = {i["date"]: i for i in plan["inserts"]}
        assert by_target[date(2026, 1, 12)]["food_id"] == 1  # mon's entry
        assert by_target[date(2026, 1, 13)]["food_id"] == 2  # tue's entry

    def test_two_days_map_to_two_consecutive_target_dates(self):
        d1, d2 = date(2026, 2, 1), date(2026, 2, 2)
        entries = {
            d1: [FakeEntry(1, Meal.breakfast, 100, None, NUTRIMENTS)],
            d2: [FakeEntry(2, Meal.dinner, 100, None, NUTRIMENTS)],
        }
        plan = plan_copy(
            source_dates=[d1, d2],
            target_start=date(2026, 2, 10),
            meals=None,
            mode="append",
            entries_by_source_date=entries,
        )
        assert [d["date"] for d in plan["days"]] == [date(2026, 2, 10), date(2026, 2, 11)]

    def test_empty_source_day_produces_zero_entries_created_no_error(self):
        plan = plan_copy(
            source_dates=[date(2026, 3, 1)],
            target_start=date(2026, 3, 8),
            meals=None,
            mode="append",
            entries_by_source_date={date(2026, 3, 1): []},
        )
        assert plan["days"] == [{"date": date(2026, 3, 8), "entries_created": 0}]
        assert plan["inserts"] == []


class TestPlanCopyMealFilter:
    def test_meals_filter_restricts_which_entries_are_copied(self):
        d1 = date(2026, 4, 1)
        entries = {
            d1: [
                FakeEntry(1, Meal.breakfast, 100, None, NUTRIMENTS),
                FakeEntry(2, Meal.lunch, 100, None, NUTRIMENTS),
            ]
        }
        plan = plan_copy(
            source_dates=[d1],
            target_start=date(2026, 4, 8),
            meals=[Meal.breakfast],
            mode="append",
            entries_by_source_date=entries,
        )
        assert plan["days"] == [{"date": date(2026, 4, 8), "entries_created": 1}]
        assert plan["inserts"][0]["meal"] == Meal.breakfast

    def test_meals_none_defaults_to_all_four_meals(self):
        d1 = date(2026, 4, 1)
        entries = {
            d1: [
                FakeEntry(1, Meal.breakfast, 100, None, NUTRIMENTS),
                FakeEntry(2, Meal.lunch, 100, None, NUTRIMENTS),
                FakeEntry(3, Meal.dinner, 100, None, NUTRIMENTS),
                FakeEntry(4, Meal.snack, 100, None, NUTRIMENTS),
            ]
        }
        plan = plan_copy(
            source_dates=[d1],
            target_start=date(2026, 4, 8),
            meals=None,
            mode="append",
            entries_by_source_date=entries,
        )
        assert plan["days"][0]["entries_created"] == 4

    def test_replace_mode_delete_set_restricted_to_meals_filter(self):
        plan = plan_copy(
            source_dates=[date(2026, 4, 1)],
            target_start=date(2026, 4, 8),
            meals=[Meal.breakfast],
            mode="replace",
            entries_by_source_date={date(2026, 4, 1): []},
        )
        assert plan["deletes"] == [(date(2026, 4, 8), {Meal.breakfast})]

    def test_replace_mode_delete_set_is_all_four_meals_when_meals_none(self):
        plan = plan_copy(
            source_dates=[date(2026, 4, 1)],
            target_start=date(2026, 4, 8),
            meals=None,
            mode="replace",
            entries_by_source_date={date(2026, 4, 1): []},
        )
        assert plan["deletes"] == [(date(2026, 4, 8), set(Meal))]

    def test_append_mode_produces_no_deletes(self):
        plan = plan_copy(
            source_dates=[date(2026, 4, 1)],
            target_start=date(2026, 4, 8),
            meals=None,
            mode="append",
            entries_by_source_date={date(2026, 4, 1): []},
        )
        assert plan["deletes"] == []


class TestPlanCopyOverlap:
    """The trickiest case: source=[mon, tue], target_start=tue, mode=
    "replace" -- tue is both a source date and a target date. Because
    `entries_by_source_date` is captured *before* any deletes run (that's
    the caller's contract, enforced by the router reading everything up
    front), tue's original entries survive in memory long enough to be
    copied into wed, even though tue's row in the DB gets wiped as part of
    "replace"-ing mon's copy onto it.
    """

    def test_overlapping_source_and_target_replace_mode_reads_before_deletes(self):
        mon = date(2026, 5, 4)
        tue = date(2026, 5, 5)
        wed = date(2026, 5, 6)

        mon_entry = FakeEntry(1, Meal.breakfast, 100, None, NUTRIMENTS)
        tue_entry = FakeEntry(2, Meal.lunch, 150, None, NUTRIMENTS)
        entries = {mon: [mon_entry], tue: [tue_entry]}

        plan = plan_copy(
            source_dates=[mon, tue],
            target_start=tue,  # overlap: tue is both source[1] and target[0]
            meals=None,
            mode="replace",
            entries_by_source_date=entries,
        )

        # mon -> tue, tue -> wed
        assert [d["date"] for d in plan["days"]] == [tue, wed]

        # Deletes hit both target dates (tue and wed), clearing whatever was
        # there before -- including tue's *original* entries, which is fine
        # because we already captured them above.
        delete_dates = {d for d, _ in plan["deletes"]}
        assert delete_dates == {tue, wed}

        by_target = {}
        for item in plan["inserts"]:
            by_target.setdefault(item["date"], []).append(item)

        # tue's new content is mon's original entry (food_id=1)
        assert [i["food_id"] for i in by_target[tue]] == [1]
        # wed's new content is tue's *original* entry (food_id=2), captured
        # before tue got wiped -- not corrupted/lost/duplicated.
        assert [i["food_id"] for i in by_target[wed]] == [2]

    def test_overlap_with_append_mode_accumulates_rather_than_clears(self):
        mon = date(2026, 5, 4)
        tue = date(2026, 5, 5)
        entries = {mon: [FakeEntry(1, Meal.breakfast, 100, None, NUTRIMENTS)]}

        plan = plan_copy(
            source_dates=[mon],
            target_start=tue,
            meals=None,
            mode="append",
            entries_by_source_date=entries,
        )
        assert plan["deletes"] == []
        assert len(plan["inserts"]) == 1


class TestPlanCopySnapshotPreservation:
    def test_copied_snapshot_equals_source_snapshot_byte_for_byte(self):
        d1 = date(2026, 6, 1)
        source_snapshot = dict(NUTRIMENTS)
        entries = {d1: [FakeEntry(1, Meal.breakfast, 100, None, source_snapshot)]}

        plan = plan_copy(
            source_dates=[d1],
            target_start=date(2026, 6, 8),
            meals=None,
            mode="append",
            entries_by_source_date=entries,
        )

        assert plan["inserts"][0]["nutriments_snapshot"] == source_snapshot

    def test_copied_snapshot_is_independent_of_a_later_food_nutriments_change(self):
        """Simulates the underlying `Food.nutriments` changing after the
        source entry was logged: the source entry's OWN snapshot (already
        frozen at creation time) is what's copied, never re-derived from
        the (now-different) `Food` row. `plan_copy` never even sees a
        `Food` -- it only ever reads `entry.nutriments_snapshot` -- so this
        test also documents that by construction."""
        d1 = date(2026, 6, 1)
        frozen_snapshot = dict(NUTRIMENTS)  # what was frozen at log time
        entries = {d1: [FakeEntry(1, Meal.breakfast, 100, None, frozen_snapshot)]}

        # Food.nutriments changes later -- irrelevant, plan_copy never reads it.
        current_food_nutriments = dict(CHANGED_NUTRIMENTS)
        assert current_food_nutriments != frozen_snapshot

        plan = plan_copy(
            source_dates=[d1],
            target_start=date(2026, 6, 8),
            meals=None,
            mode="append",
            entries_by_source_date=entries,
        )

        assert plan["inserts"][0]["nutriments_snapshot"] == frozen_snapshot
        assert plan["inserts"][0]["nutriments_snapshot"] != current_food_nutriments

    def test_copied_snapshot_dict_is_a_distinct_object_not_shared_reference(self):
        """Mutating the copy must not mutate the source entry's snapshot --
        guards against a shallow-shared-reference bug."""
        d1 = date(2026, 6, 1)
        source_snapshot = dict(NUTRIMENTS)
        entries = {d1: [FakeEntry(1, Meal.breakfast, 100, None, source_snapshot)]}

        plan = plan_copy(
            source_dates=[d1],
            target_start=date(2026, 6, 8),
            meals=None,
            mode="append",
            entries_by_source_date=entries,
        )

        copied = plan["inserts"][0]["nutriments_snapshot"]
        copied["kcal"] = -1
        assert source_snapshot["kcal"] != -1
