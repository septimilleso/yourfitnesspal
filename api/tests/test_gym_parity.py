"""Shared parity cases for the pure gym rules.

The JSON fixture is read here by pytest and by the web Vitest suite, so every
case runs on both sides. Each case is {"fn", "name", "input", "expected"}: the
input is a JSON object with the function's arguments, decoded below.
"""

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from app.models.exercise import Tracking
from app.services.gym_rules import (
    DiffExercise,
    ExerciseProgress,
    format_set,
    normalize_supersets,
    rest_after_completion,
    set_problem,
    template_diff,
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


RUNNERS: dict[str, Callable[[dict], Any]] = {
    "normalize_supersets": _run_normalize_supersets,
    "set_problem": _run_set_problem,
    "rest_after_completion": _run_rest_after_completion,
    "template_diff": _run_template_diff,
    "format_set": _run_format_set,
}

CASES: list[dict] = json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_gym_parity_case(case: dict) -> None:
    runner = RUNNERS.get(case["fn"])
    assert runner is not None, f"unknown fn {case['fn']!r} in case {case['name']!r}"
    assert runner(case["input"]) == case["expected"]


def test_fixture_covers_every_fn() -> None:
    assert {case["fn"] for case in CASES} == set(RUNNERS)
