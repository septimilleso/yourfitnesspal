"""Pure gym rules (DB-free)."""

from app.models.exercise import Tracking
from app.services.gym_rules import (
    DiffExercise,
    ExerciseProgress,
    derive_tracking,
    format_duration,
    format_kg,
    format_set,
    normalize_supersets,
    rest_after_completion,
    set_problem,
    template_diff,
)


def test_derive_tracking() -> None:
    assert derive_tracking("stretching", "body only") is Tracking.duration
    assert derive_tracking("cardio", "machine") is Tracking.duration
    assert derive_tracking("strength", "body only") is Tracking.reps
    assert derive_tracking("strength", "barbell") is Tracking.weight_reps
    assert derive_tracking("strength", None) is Tracking.weight_reps


def test_normalize_supersets() -> None:
    assert normalize_supersets([]) == []
    assert normalize_supersets([None, 7, 7, None]) == [None, 1, 1, None]
    # a lone member is not a superset
    assert normalize_supersets([3, None, 5, 5, 5]) == [None, None, 1, 1, 1]
    # the same value in two separate runs gives two groups
    assert normalize_supersets([2, 2, None, 2, 2]) == [1, 1, None, 2, 2]
    # adjacent different groups stay different
    assert normalize_supersets([4, 4, 9, 9]) == [1, 1, 2, 2]


def test_set_problem() -> None:
    assert set_problem(Tracking.weight_reps, 80, 8, None) is None
    assert set_problem(Tracking.weight_reps, None, 8, None) == "weight and reps are required"
    assert set_problem(Tracking.weight_reps, 80, None, None) == "weight and reps are required"
    assert set_problem(Tracking.reps, None, 10, None) is None
    assert set_problem(Tracking.reps, 10, None, None) == "reps are required"
    assert set_problem(Tracking.duration, None, None, 60) is None
    assert set_problem(Tracking.duration, None, None, None) == "duration is required"


def _p(rest, group, sets, done):
    return ExerciseProgress(
        rest_seconds=rest, superset_group=group,
        set_positions=frozenset(sets), completed_positions=frozenset(done),
    )


def test_rest_after_completion_single_exercise() -> None:
    assert rest_after_completion([_p(90, None, {0, 1}, {0})], 0, 0) == 90
    assert rest_after_completion([_p(0, None, {0}, {0})], 0, 0) is None


def test_rest_after_completion_superset_waits_for_round() -> None:
    a_done = [_p(30, 1, {0, 1}, {0}), _p(120, 1, {0, 1}, set())]
    assert rest_after_completion(a_done, 0, 0) is None
    both_done = [_p(30, 1, {0, 1}, {0}), _p(120, 1, {0, 1}, {0})]
    # the last exercise of the group decides the rest
    assert rest_after_completion(both_done, 1, 0) == 120
    # an exercise with no set at that position does not block the round
    short = [_p(30, 1, {0, 1, 2}, {2}), _p(120, 1, {0, 1}, set())]
    assert rest_after_completion(short, 0, 2) == 120


def test_formatting() -> None:
    assert format_kg(80) == "80"
    assert format_kg(37.5) == "37,5"
    assert format_kg(2.25) == "2,25"
    assert format_duration(90) == "1:30"
    assert format_duration(5) == "0:05"
    assert format_set(Tracking.weight_reps, (80, 8, None)) == "80 kg × 8"
    assert format_set(Tracking.reps, (None, 12, None)) == "12 rip"
    assert format_set(Tracking.reps, (10, 12, None)) == "10 kg × 12"
    assert format_set(Tracking.duration, (None, None, 75)) == "1:15"


def _ex(exercise_id, name, sets, rest=90, group=None, tracking=Tracking.weight_reps):
    return DiffExercise(
        exercise_id=exercise_id, name=name, tracking=tracking, rest_seconds=rest,
        superset_group=group, sets=tuple(sets),
    )


def test_template_diff_no_changes() -> None:
    squat = _ex(1, "Squat", [(80, 8, None), (80, 8, None)])
    assert template_diff([squat], [squat]) == []


def test_template_diff_values_sets_and_rest() -> None:
    before = [_ex(1, "Squat", [(80, 8, None), (80, 8, None)], rest=90)]
    after = [_ex(1, "Squat", [(85, 8, None), (80, 8, None), (80, 6, None)], rest=120)]
    assert template_diff(before, after) == [
        "Squat: serie 1 80 kg × 8 → 85 kg × 8",
        "Squat: +1 serie",
        "Squat: riposo 1:30 → 2:00",
    ]
    assert template_diff(after, before) == [
        "Squat: serie 1 85 kg × 8 → 80 kg × 8",
        "Squat: -1 serie",
        "Squat: riposo 2:00 → 1:30",
    ]


def test_template_diff_added_removed_and_order() -> None:
    squat = _ex(1, "Squat", [(80, 8, None)])
    curl = _ex(2, "Curl", [(10, 12, None)])
    plank = _ex(3, "Plank", [(None, None, 60)], tracking=Tracking.duration)
    assert template_diff([squat, curl], [squat, plank]) == ["Aggiunto: Plank", "Rimosso: Curl"]
    assert template_diff([squat, curl], [curl, squat]) == ["Ordine o superserie modificati"]
    linked = [_ex(1, "Squat", [(80, 8, None)], group=1), _ex(2, "Curl", [(10, 12, None)], group=1)]
    assert template_diff([squat, curl], linked) == ["Ordine o superserie modificati"]


def test_template_diff_matches_repeated_exercise_by_occurrence() -> None:
    before = [_ex(1, "Squat", [(60, 10, None)]), _ex(1, "Squat", [(100, 3, None)])]
    after = [_ex(1, "Squat", [(60, 10, None)]), _ex(1, "Squat", [(105, 3, None)])]
    assert template_diff(before, after) == ["Squat: serie 1 100 kg × 3 → 105 kg × 3"]
