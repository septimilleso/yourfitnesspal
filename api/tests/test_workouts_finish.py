"""Finishing a workout, the template diff and history (needs Postgres)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.workout import WorkoutStatus
from app.schemas.workout import (
    FinishIn,
    SaveAsTemplateIn,
    SetPatch,
    TemplateIn,
    WorkoutExerciseAdd,
    WorkoutStart,
)
from app.services import templates, workouts
from app.services.errors import Invalid, NotFound
from tests.factories import GYM, make_exercise, make_user

T0 = datetime(2026, 9, 24, 18, 0, tzinfo=UTC)


@pytest.fixture
def clock(monkeypatch):
    class Clock:
        current = T0

        def advance(self, seconds: int) -> None:
            self.current += timedelta(seconds=seconds)

    c = Clock()
    monkeypatch.setattr(workouts, "now", lambda: c.current)
    return c


async def _squat_template(db, user, squat_id):
    return await templates.create_template(db, user, TemplateIn.model_validate({
        "name": "Giorno 1",
        "exercises": [{"exercise_id": squat_id, "rest_seconds": 90,
                       "sets": [{"weight_kg": 80, "reps": 8}, {"weight_kg": 80, "reps": 8}]}],
    }))


async def test_finish_requires_confirmation_for_incomplete_sets(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    template = await _squat_template(db, user, squat.id)
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))

    with pytest.raises(Invalid, match="empty_workout"):
        await workouts.finish_workout(db, user, workout.id, FinishIn(discard_incomplete=True))

    first, _second = workout.exercises[0].sets
    workout = await workouts.complete_set(
        db, user, workout.id, first.id, SetPatch(weight_kg=85)
    )
    with pytest.raises(Invalid, match="incomplete_sets"):
        await workouts.finish_workout(db, user, workout.id, FinishIn())

    clock.advance(3600)
    finished = await workouts.finish_workout(
        db, user, workout.id, FinishIn(discard_incomplete=True)
    )
    assert finished.status is WorkoutStatus.finished
    assert finished.finished_at == T0 + timedelta(seconds=3600)
    assert finished.rest_ends_at is None
    assert [(s.weight_kg, s.reps) for s in finished.exercises[0].sets] == [(85, 8)]
    assert finished.template_diff == [
        "Zzq Squat: serie 1 80 kg × 8 → 85 kg × 8",
        "Zzq Squat: -1 serie",
    ]
    assert await workouts.get_active(db, user) is None
    with pytest.raises(Invalid, match="not in progress"):
        await workouts.add_set(db, user, workout.id, finished.exercises[0].id)


async def test_finish_drops_exercises_without_done_sets(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    curl = await make_exercise(db, name="Zzq Curl")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    for exercise in (squat, curl):
        workout = await workouts.add_exercise(
            db, user, workout.id, WorkoutExerciseAdd(exercise_id=exercise.id)
        )
    workout = await workouts.complete_set(
        db, user, workout.id, workout.exercises[1].sets[0].id, SetPatch(weight_kg=12, reps=10)
    )
    finished = await workouts.finish_workout(
        db, user, workout.id, FinishIn(discard_incomplete=True)
    )
    assert [e.exercise.name for e in finished.exercises] == ["Zzq Curl"]
    assert finished.template_diff == []  # no template


async def test_apply_to_template_and_next_previous(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    template = await _squat_template(db, user, squat.id)
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    first, second = workout.exercises[0].sets
    await workouts.complete_set(db, user, workout.id, first.id, SetPatch(weight_kg=85))
    await workouts.complete_set(db, user, workout.id, second.id, SetPatch())
    finished = await workouts.finish_workout(db, user, workout.id, FinishIn())
    assert finished.template_diff == ["Zzq Squat: serie 1 80 kg × 8 → 85 kg × 8"]

    updated = await workouts.apply_to_template(db, user, workout.id)
    assert [(s.weight_kg, s.reps) for s in updated.exercises[0].sets] == [(85, 8), (80, 8)]
    assert (await workouts.get_workout(db, user, workout.id)).template_diff == []

    clock.advance(86400)
    again = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    assert (again.exercises[0].sets[0].weight_kg, again.exercises[0].sets[0].previous.weight_kg) == (
        85, 85
    )


async def test_save_as_template_links_the_workout(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=60, reps=5)
    )
    with pytest.raises(Invalid, match="not finished"):
        await workouts.save_as_template(db, user, workout.id, SaveAsTemplateIn(name="Nuovo"))
    await workouts.finish_workout(db, user, workout.id, FinishIn())
    with pytest.raises(Invalid, match="has no template"):
        await workouts.apply_to_template(db, user, workout.id)

    saved = await workouts.save_as_template(db, user, workout.id, SaveAsTemplateIn(name="Nuovo"))
    assert saved.name == "Nuovo"
    assert [(s.weight_kg, s.reps) for s in saved.exercises[0].sets] == [(60, 5)]
    assert (await workouts.get_workout(db, user, workout.id)).template_id == saved.id


async def test_history_pages_and_delete(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    ids = []
    for _ in range(3):
        workout = await workouts.start_workout(db, user, WorkoutStart())
        workout = await workouts.add_exercise(
            db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
        )
        await workouts.complete_set(
            db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=60, reps=5)
        )
        await workouts.finish_workout(db, user, workout.id, FinishIn())
        ids.append(workout.id)
        clock.advance(3600)

    first = await workouts.list_history(db, user, limit=2)
    assert [item.id for item in first.items] == [ids[2], ids[1]]
    assert first.items[0].exercises[0].name == "Zzq Squat"
    assert first.items[0].exercises[0].sets == 1
    assert first.next_before is not None
    second = await workouts.list_history(db, user, before=first.next_before, limit=2)
    assert [item.id for item in second.items] == [ids[0]]
    assert second.next_before is None

    await workouts.delete_workout(db, user, ids[0])
    with pytest.raises(NotFound):
        await workouts.get_workout(db, user, ids[0])

    # cancelling a live workout
    live = await workouts.start_workout(db, user, WorkoutStart())
    await workouts.delete_workout(db, user, live.id)
    assert await workouts.get_active(db, user) is None
