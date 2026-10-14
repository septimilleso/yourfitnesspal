"""Shared parity cases for the pure gym rules.

The JSON fixture is read here by pytest and by the web Vitest suite, so every
case runs on both sides. Each case is {"fn", "name", "input", "expected"}: the
input is a JSON object with the function's arguments, decoded below.
"""

import json
from collections.abc import Callable
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from app.models.exercise import Tracking
from app.models.workout import WorkoutStatus
from app.services.gym_rules import (
    DiffExercise,
    ExerciseProgress,
    NoRestTimer,
    SetState,
    StateExercise,
    StateSet,
    StateWorkout,
    canonical_workout,
    clamp_times,
    exercise_prefill,
    finish_problem,
    finish_prune,
    format_set,
    next_set_values,
    normalize_supersets,
    rest_action,
    rest_after_completion,
    same_content,
    set_problem,
    template_diff,
    tracking_reset,
)

FIXTURE = Path(__file__).parent / "fixtures" / "gym_parity.json"


def _progress(raw: dict) -> ExerciseProgress:
    return ExerciseProgress(
        rest_seconds=raw["rest_seconds"],
        superset_group=raw["superset_group"],
        set_positions=frozenset(raw["set_positions"]),
        completed_positions=frozenset(raw["completed_positions"]),
    )


def _diff_exercise(raw: dict) -> DiffExercise:
    return DiffExercise(
        exercise_id=raw["exercise_id"],
        name=raw["name"],
        tracking=Tracking(raw["tracking"]),
        rest_seconds=raw["rest_seconds"],
        superset_group=raw["superset_group"],
        sets=tuple(tuple(values) for values in raw["sets"]),
    )


def _run_normalize_supersets(args: dict) -> Any:
    return normalize_supersets(args["groups"])


def _run_set_problem(args: dict) -> Any:
    return set_problem(
        Tracking(args["tracking"]), args["weight_kg"], args["reps"], args["duration_s"]
    )


def _run_rest_after_completion(args: dict) -> Any:
    exercises = [_progress(raw) for raw in args["exercises"]]
    return rest_after_completion(exercises, args["index"], args["position"])


def _run_template_diff(args: dict) -> Any:
    template = [_diff_exercise(raw) for raw in args["template"]]
    workout = [_diff_exercise(raw) for raw in args["workout"]]
    return template_diff(template, workout)


def _run_format_set(args: dict) -> Any:
    return format_set(Tracking(args["tracking"]), tuple(args["values"]))


def _optional_tuple(raw: list | None) -> tuple | None:
    return None if raw is None else tuple(raw)


def _run_next_set_values(args: dict) -> Any:
    last = _optional_tuple(args["last"])
    previous_first = _optional_tuple(args["previous_first"])
    return list(next_set_values(last, previous_first))


def _run_exercise_prefill(args: dict) -> Any:
    rest, sets = exercise_prefill(args["previous_rest"], [tuple(s) for s in args["previous_sets"]])
    return {"rest_seconds": rest, "sets": [list(s) for s in sets]}


def _run_tracking_reset(args: dict) -> Any:
    sets = [
        SetState(
            weight_kg=raw["weight_kg"], reps=raw["reps"], duration_s=raw["duration_s"],
            completed=raw["completed"],
        )
        for raw in args["sets"]
    ]
    return [
        {
            "weight_kg": state.weight_kg, "reps": state.reps,
            "duration_s": state.duration_s, "completed": state.completed,
        }
        for state in tracking_reset(Tracking(args["tracking"]), sets)
    ]


def _run_rest_action(args: dict) -> Any:
    ends_at = None if args["ends_at"] is None else datetime.fromisoformat(args["ends_at"])
    try:
        new_ends_at, new_total = rest_action(
            datetime.fromisoformat(args["now"]),
            ends_at,
            args["total_s"],
            start_s=args["start_s"],
            delta_s=args["delta_s"],
            skip=args["skip"],
        )
    except NoRestTimer as exc:
        return {"error": str(exc)}
    return {
        "ends_at": None if new_ends_at is None else new_ends_at.isoformat(),
        "total_s": new_total,
    }


def _run_finish_problem(args: dict) -> Any:
    return finish_problem(args["completed"], args["discard_incomplete"])


def _run_finish_prune(args: dict) -> Any:
    return [[index, list(kept)] for index, kept in finish_prune(args["completed"])]


def _optional_datetime(raw: str | None) -> datetime | None:
    return None if raw is None else datetime.fromisoformat(raw)


def _optional_iso(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def _state_workout(raw: dict) -> StateWorkout:
    return StateWorkout(
        name=raw["name"],
        template_id=raw["template_id"],
        status=WorkoutStatus(raw["status"]),
        started_at=datetime.fromisoformat(raw["started_at"]),
        finished_at=_optional_datetime(raw["finished_at"]),
        rest_ends_at=_optional_datetime(raw["rest_ends_at"]),
        rest_total_s=raw["rest_total_s"],
        exercises=tuple(
            StateExercise(
                exercise_id=exercise["exercise_id"],
                rest_seconds=exercise["rest_seconds"],
                superset_group=exercise["superset_group"],
                note=exercise["note"],
                sets=tuple(
                    StateSet(
                        weight_kg=raw_set["weight_kg"],
                        reps=raw_set["reps"],
                        duration_s=raw_set["duration_s"],
                        completed_at=_optional_datetime(raw_set["completed_at"]),
                    )
                    for raw_set in exercise["sets"]
                ),
            )
            for exercise in raw["exercises"]
        ),
    )


def _workout_json(state: StateWorkout) -> dict:
    return {
        "name": state.name,
        "template_id": state.template_id,
        "status": state.status.value,
        "started_at": state.started_at.isoformat(),
        "finished_at": _optional_iso(state.finished_at),
        "rest_ends_at": _optional_iso(state.rest_ends_at),
        "rest_total_s": state.rest_total_s,
        "exercises": [
            {
                "exercise_id": exercise.exercise_id,
                "rest_seconds": exercise.rest_seconds,
                "superset_group": exercise.superset_group,
                "note": exercise.note,
                "sets": [
                    {
                        "weight_kg": s.weight_kg,
                        "reps": s.reps,
                        "duration_s": s.duration_s,
                        "completed_at": _optional_iso(s.completed_at),
                    }
                    for s in exercise.sets
                ],
            }
            for exercise in state.exercises
        ],
    }


def _run_canonical_workout(args: dict) -> Any:
    return _workout_json(canonical_workout(_state_workout(args["workout"])))


def _run_same_content(args: dict) -> Any:
    return same_content(_state_workout(args["a"]), _state_workout(args["b"]))


def _run_clamp_times(args: dict) -> Any:
    clamped = clamp_times(_state_workout(args["workout"]), datetime.fromisoformat(args["now"]))
    return _workout_json(clamped)


RUNNERS: dict[str, Callable[[dict], Any]] = {
    "canonical_workout": _run_canonical_workout,
    "same_content": _run_same_content,
    "clamp_times": _run_clamp_times,
    "normalize_supersets": _run_normalize_supersets,
    "set_problem": _run_set_problem,
    "rest_after_completion": _run_rest_after_completion,
    "template_diff": _run_template_diff,
    "format_set": _run_format_set,
    "next_set_values": _run_next_set_values,
    "exercise_prefill": _run_exercise_prefill,
    "tracking_reset": _run_tracking_reset,
    "rest_action": _run_rest_action,
    "finish_problem": _run_finish_problem,
    "finish_prune": _run_finish_prune,
}

CASES: list[dict] = json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_gym_parity_case(case: dict) -> None:
    runner = RUNNERS.get(case["fn"])
    assert runner is not None, f"unknown fn {case['fn']!r} in case {case['name']!r}"
    assert runner(case["input"]) == case["expected"]


def test_fixture_covers_every_fn() -> None:
    assert {case["fn"] for case in CASES} == set(RUNNERS)


def test_canonical_weight_is_float_and_decimal_content_matches() -> None:
    # Decimal values from the database are not expressible in JSON, so they are
    # checked here: the canonical weight is a float, as with `_norm`.
    started = datetime(2026, 10, 14, 9, 0, tzinfo=UTC)

    def workout(weight: float | Decimal) -> StateWorkout:
        completed = datetime(2026, 10, 14, 9, 5, tzinfo=UTC)
        sets = (StateSet(weight_kg=weight, reps=8, duration_s=None, completed_at=completed),)
        exercise = StateExercise(
            exercise_id=1, rest_seconds=90, superset_group=None, note=None, sets=sets
        )
        return StateWorkout(
            name="Push", template_id=None, status=WorkoutStatus.in_progress,
            started_at=started, finished_at=None, rest_ends_at=None, rest_total_s=None,
            exercises=(exercise,),
        )

    canonical = canonical_workout(workout(Decimal("37.50")))
    assert canonical.exercises[0].sets[0].weight_kg == 37.5
    assert isinstance(canonical.exercises[0].sets[0].weight_kg, float)
    assert same_content(workout(Decimal("80.00")), workout(80.0))
    assert not same_content(workout(Decimal("80.5")), workout(80.0))
