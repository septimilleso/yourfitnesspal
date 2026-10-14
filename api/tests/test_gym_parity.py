"""Shared parity cases for the pure gym rules.

The JSON fixture is read here by pytest and by the web Vitest suite, so every
case runs on both sides. Each case is {"fn", "name", "input", "expected"}: the
input is a JSON object with the function's arguments, decoded below.
"""

import json
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from app.models.exercise import Tracking
from app.services.gym_rules import (
    DiffExercise,
    ExerciseProgress,
    NoRestTimer,
    SetState,
    exercise_prefill,
    finish_problem,
    finish_prune,
    format_set,
    next_set_values,
    normalize_supersets,
    rest_action,
    rest_after_completion,
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


RUNNERS: dict[str, Callable[[dict], Any]] = {
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
