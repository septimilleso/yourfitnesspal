"""The live workout session (needs Postgres)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.exc import IntegrityError

from app.db import engine
from app.models.exercise import Tracking
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus
from app.schemas.workout import (
    LayoutIn,
    RestIn,
    SetPatch,
    TemplateIn,
    WorkoutExerciseAdd,
    WorkoutExercisePatch,
    WorkoutStart,
)
from app.services import templates, workouts
from app.services.errors import Invalid, NotFound
from tests.factories import GYM, make_exercise, make_finished_workout, make_user

T0 = datetime(2026, 9, 24, 18, 0, tzinfo=UTC)


async def test_start_integrity_conflict_matches_existing_active_error(monkeypatch) -> None:
    db = SimpleNamespace(add=lambda _: None, rollback=AsyncMock())
    user = SimpleNamespace(id=1, role="user", permissions=GYM)
    monkeypatch.setattr(workouts, "_active_id", AsyncMock(return_value=None))
    monkeypatch.setattr(
        workouts,
        "_save",
        AsyncMock(side_effect=IntegrityError("insert", {}, RuntimeError("unique"))),
    )

    with pytest.raises(Invalid, match="a workout is already in progress"):
        await workouts.start_workout(db, user, WorkoutStart())
    db.rollback.assert_awaited_once()


@pytest.fixture
def clock(monkeypatch):
    """Freeze `workouts.now()`; `clock.advance(seconds)` moves it forward."""

    class Clock:
        current = T0

        def advance(self, seconds: int) -> None:
            self.current += timedelta(seconds=seconds)

    c = Clock()
    monkeypatch.setattr(workouts, "now", lambda: c.current)
    return c


async def _template(db, user, *items):
    return await templates.create_template(db, user, TemplateIn.model_validate({
        "name": "Giorno 1", "exercises": list(items),
    }))


async def test_start_from_template_copies_values(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    template = await _template(db, user, {
        "exercise_id": squat.id, "rest_seconds": 90,
        "sets": [{"weight_kg": 80, "reps": 8}, {"weight_kg": 80, "reps": 8}],
    })
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    assert workout.status is WorkoutStatus.in_progress
    assert workout.name == "Giorno 1"
    assert workout.template_id == template.id
    assert workout.started_at == T0
    assert workout.server_now == T0
    [item] = workout.exercises
    assert [(s.weight_kg, s.reps, s.completed_at) for s in item.sets] == [
        (80, 8, None), (80, 8, None)
    ]
    assert item.sets[0].previous is None
    assert (await templates.get_template(db, user, template.id)).last_used_at == T0

    active = await workouts.get_active(db, user)
    assert active is not None and active.id == workout.id
    with pytest.raises(Invalid, match="already in progress"):
        await workouts.start_workout(db, user, WorkoutStart())


async def test_empty_workout_and_previous_values(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    # an earlier finished workout: 2 sets of squat with 120 s rest
    db.add(Workout(
        user_id=user.id, name="Old", status=WorkoutStatus.finished,
        started_at=T0 - timedelta(days=2), finished_at=T0 - timedelta(days=2, minutes=-50),
        exercises=[WorkoutExercise(
            exercise_id=squat.id, position=0, rest_seconds=120,
            sets=[WorkoutSet(position=0, weight_kg=70, reps=10, completed_at=T0),
                  WorkoutSet(position=1, weight_kg=75, reps=8, completed_at=T0)],
        )],
    ))
    await db.flush()

    workout = await workouts.start_workout(db, user, WorkoutStart())
    assert workout.name.startswith("Allenamento")
    assert workout.template_id is None

    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    [item] = workout.exercises
    # prefilled from the last time, with that rest
    assert item.rest_seconds == 120
    assert [(s.weight_kg, s.reps) for s in item.sets] == [(70, 10), (75, 8)]
    assert [(s.previous.weight_kg, s.previous.reps) for s in item.sets] == [(70, 10), (75, 8)]

    workout = await workouts.add_set(db, user, workout.id, item.id)
    third = workout.exercises[0].sets[2]
    assert (third.weight_kg, third.reps, third.previous) == (75, 8, None)


async def test_previous_follows_completed_position_skipping_incomplete(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    db.add(Workout(
        user_id=user.id, name="Old", status=WorkoutStatus.finished,
        started_at=T0 - timedelta(days=2), finished_at=T0 - timedelta(days=2, minutes=-50),
        exercises=[WorkoutExercise(
            exercise_id=squat.id, position=0, rest_seconds=90,
            sets=[
                WorkoutSet(position=0, weight_kg=80, reps=8, completed_at=T0),
                WorkoutSet(position=1, weight_kg=120, reps=1, completed_at=None),
                WorkoutSet(position=2, weight_kg=100, reps=5, completed_at=T0),
            ],
        )],
    ))
    await db.flush()

    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    [item] = workout.exercises
    assert len(item.sets) == 2
    workout = await workouts.add_set(db, user, workout.id, item.id)
    [item] = workout.exercises
    assert len(item.sets) == 3
    assert [(s.previous.weight_kg, s.previous.reps) if s.previous else None for s in item.sets] == [
        (80, 8), (100, 5), None,
    ]


async def test_max_set_per_position(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Max Squat")
    old = Workout(
        user_id=user.id, name="Old A", status=WorkoutStatus.finished,
        started_at=T0 - timedelta(days=3), finished_at=T0 - timedelta(days=3) + timedelta(minutes=50),
        exercises=[WorkoutExercise(
            exercise_id=squat.id, position=0, rest_seconds=90,
            sets=[
                WorkoutSet(position=0, weight_kg=80, reps=8, completed_at=T0),
                WorkoutSet(position=1, weight_kg=120, reps=1, completed_at=None),
                WorkoutSet(position=2, weight_kg=100, reps=5, completed_at=T0),
                WorkoutSet(position=3, weight_kg=70, reps=10, completed_at=T0),
            ],
        )],
    )
    db.add(old)
    await db.flush()
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=2), minutes=50,
        items=[(squat, [(90, 6, None), (100, 4, None)])],
    )

    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    while len(workout.exercises[0].sets) < 4:
        workout = await workouts.add_set(db, user, workout.id, workout.exercises[0].id)
    [item] = workout.exercises
    assert [(s.max_set.weight_kg, s.max_set.reps) if s.max_set else None for s in item.sets] == [
        (90, 6), (100, 5), (70, 10), None,
    ]


async def test_max_set_ordering(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    weighted = await make_exercise(db, name="Zzq Max Ordering")
    bodyweight = await make_exercise(db, name="Zzq Max Bodyweight")
    timed = await make_exercise(db, name="Zzq Max Duration", tracking=Tracking.duration)
    for days, sets in ((3, [(90, 4, None)]), (2, [(90, 5, None)]), (1, [(80, 8, None)])):
        await make_finished_workout(
            db, user, started_at=T0 - timedelta(days=days), minutes=50,
            items=[(weighted, sets)],
        )
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=2), minutes=50,
        items=[(bodyweight, [(0, 12, None)])],
    )
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=1), minutes=50,
        items=[(bodyweight, [(0, 15, None)])],
    )
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=2), minutes=50,
        items=[(timed, [(None, None, 60)])],
    )
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=1), minutes=50,
        items=[(timed, [(None, None, 90)])],
    )

    best = await workouts.best_sets(db, user, {weighted.id, bodyweight.id, timed.id})
    assert (best[weighted.id][0].weight_kg, best[weighted.id][0].reps) == (90, 5)
    assert (best[bodyweight.id][0].weight_kg, best[bodyweight.id][0].reps) == (0, 15)
    assert best[timed.id][0].duration_s == 90


async def test_max_set_ignores_other_users_and_active_workout(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    other = await make_user(db, username="bob", permissions=GYM)
    squat = await make_exercise(db, name="Zzq Max Private")
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=1), minutes=50,
        items=[(squat, [(80, 8, None)])],
    )
    await make_finished_workout(
        db, other, started_at=T0 - timedelta(days=1), minutes=50,
        items=[(squat, [(200, 20, None)])],
    )
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    item = workout.exercises[0]
    workout = await workouts.complete_set(
        db, user, workout.id, item.sets[0].id, SetPatch(weight_kg=300, reps=30)
    )
    assert (workout.exercises[0].sets[0].max_set.weight_kg,
            workout.exercises[0].sets[0].max_set.reps) == (80, 8)


async def test_max_set_none_for_finished_workout(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Max Finished")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    workout = await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id,
        SetPatch(weight_kg=80, reps=8),
    )
    finished = await workouts.finish_workout(db, user, workout.id, workouts.FinishIn())
    assert all(s.max_set is None for item in finished.exercises for s in item.sets)
    loaded = await workouts.get_workout(db, user, workout.id)
    assert all(s.max_set is None for item in loaded.exercises for s in item.sets)


async def test_max_set_single_query(db, clock) -> None:
    from sqlalchemy import event

    user = await make_user(db, permissions=GYM)
    exercises = [await make_exercise(db, name=f"Zzq Max Query {i}") for i in range(3)]
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=1), minutes=50,
        items=[(exercise, [(80, 8, None)]) for exercise in exercises],
    )
    statements = []

    def count_statement(*_args):
        statements.append(None)

    event.listen(engine.sync_engine, "before_cursor_execute", count_statement)
    try:
        await workouts.best_sets(db, user, {exercises[0].id})
        assert len(statements) == 1
        statements.clear()
        await workouts.best_sets(db, user, {exercise.id for exercise in exercises})
        assert len(statements) == 1
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count_statement)


async def test_edit_sets_and_exercises(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    curl = await make_exercise(db, name="Zzq Curl")
    plank = await make_exercise(db, name="Zzq Plank", tracking=Tracking.duration)
    workout = await workouts.start_workout(db, user, WorkoutStart())
    for exercise in (squat, curl, plank):
        workout = await workouts.add_exercise(
            db, user, workout.id, WorkoutExerciseAdd(exercise_id=exercise.id)
        )
    squat_item, curl_item, plank_item = workout.exercises

    first = squat_item.sets[0].id
    workout = await workouts.patch_set(
        db, user, workout.id, first, SetPatch(weight_kg=82.5, reps=5)
    )
    assert (workout.exercises[0].sets[0].weight_kg, workout.exercises[0].sets[0].reps) == (82.5, 5)
    workout = await workouts.patch_set(db, user, workout.id, first, SetPatch(weight_kg=None))
    assert workout.exercises[0].sets[0].weight_kg is None
    assert workout.exercises[0].sets[0].reps == 5  # untouched: not sent

    workout = await workouts.patch_exercise(db, user, workout.id, curl_item.id,
                                            WorkoutExercisePatch(rest_seconds=45, note="lento"))
    assert (workout.exercises[1].rest_seconds, workout.exercises[1].note) == (45, "lento")
    workout = await workouts.patch_exercise(db, user, workout.id, curl_item.id,
                                            WorkoutExercisePatch(exercise_id=squat.id))
    assert workout.exercises[1].exercise.name == "Zzq Squat"

    workout = await workouts.set_layout(db, user, workout.id, LayoutIn.model_validate({"items": [
        {"id": plank_item.id, "superset_group": None},
        {"id": squat_item.id, "superset_group": 1},
        {"id": curl_item.id, "superset_group": 1},
    ]}))
    assert [e.id for e in workout.exercises] == [plank_item.id, squat_item.id, curl_item.id]
    assert [e.superset_group for e in workout.exercises] == [None, 1, 1]
    with pytest.raises(Invalid, match="every exercise once"):
        await workouts.set_layout(db, user, workout.id, LayoutIn.model_validate(
            {"items": [{"id": plank_item.id, "superset_group": None}]}))

    workout = await workouts.remove_exercise(db, user, workout.id, curl_item.id)
    assert [e.id for e in workout.exercises] == [plank_item.id, squat_item.id]
    assert [e.superset_group for e in workout.exercises] == [None, None]

    workout = await workouts.delete_set(db, user, workout.id, first)
    assert workout.exercises[1].sets == []
    with pytest.raises(NotFound):
        await workouts.delete_set(db, user, workout.id, first)


async def test_replacing_exercise_resets_sets_only_when_tracking_changes(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    weight_exercise = await make_exercise(db, name="Zzq Weight")
    duration_exercise = await make_exercise(
        db, name="Zzq Duration", tracking=Tracking.duration
    )
    same_tracking = await make_exercise(db, name="Zzq Other Weight")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=weight_exercise.id)
    )
    item = workout.exercises[0]
    workout = await workouts.complete_set(
        db, user, workout.id, item.sets[0].id, SetPatch(weight_kg=80, reps=8)
    )

    workout = await workouts.patch_exercise(
        db, user, workout.id, item.id,
        WorkoutExercisePatch(exercise_id=duration_exercise.id),
    )
    changed = workout.exercises[0].sets[0]
    assert changed.completed_at is None
    assert (changed.weight_kg, changed.reps, changed.duration_s) == (None, None, None)

    workout = await workouts.patch_exercise(
        db, user, workout.id, item.id,
        WorkoutExercisePatch(exercise_id=weight_exercise.id),
    )
    workout = await workouts.complete_set(
        db, user, workout.id, item.sets[0].id, SetPatch(weight_kg=80, reps=8)
    )
    workout = await workouts.patch_exercise(
        db, user, workout.id, item.id,
        WorkoutExercisePatch(exercise_id=same_tracking.id),
    )
    unchanged = workout.exercises[0].sets[0]
    assert unchanged.completed_at == T0
    assert (unchanged.weight_kg, unchanged.reps, unchanged.duration_s) == (80, 8, None)


async def test_template_replace_clears_fields_not_used_by_new_tracking(db) -> None:
    user = await make_user(db, permissions=GYM)
    weight_exercise = await make_exercise(db, name="Zzq Template Weight")
    duration_exercise = await make_exercise(
        db, name="Zzq Template Duration", tracking=Tracking.duration
    )
    template = await _template(db, user, {
        "exercise_id": weight_exercise.id,
        "sets": [{"weight_kg": 80, "reps": 8, "duration_s": 90}],
    })

    replaced = await templates.replace_template(
        db, user, template.id, TemplateIn.model_validate({
            "name": template.name,
            "exercises": [{
                "exercise_id": duration_exercise.id,
                "sets": [{"weight_kg": 80, "reps": 8, "duration_s": 90}],
            }],
        }),
    )

    [set_values] = replaced.exercises[0].sets
    assert (set_values.weight_kg, set_values.reps, set_values.duration_s) == (None, None, 90)


async def test_complete_set_validates_and_starts_rest(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    item = workout.exercises[0]
    set_id = item.sets[0].id

    with pytest.raises(Invalid, match="weight and reps are required"):
        await workouts.complete_set(db, user, workout.id, set_id, SetPatch())

    # values sent with the tick are saved first
    workout = await workouts.complete_set(
        db, user, workout.id, set_id, SetPatch(weight_kg=80, reps=8)
    )
    done = workout.exercises[0].sets[0]
    assert (done.weight_kg, done.reps, done.completed_at) == (80, 8, T0)
    assert workout.rest_ends_at == T0 + timedelta(seconds=90)
    assert workout.rest_total_s == 90

    clock.advance(30)
    workout = await workouts.rest(db, user, workout.id, RestIn(delta_s=15))
    assert workout.rest_ends_at == T0 + timedelta(seconds=105)
    assert workout.rest_total_s == 105
    workout = await workouts.rest(db, user, workout.id, RestIn(delta_s=-600))
    assert workout.rest_ends_at is None
    with pytest.raises(Invalid, match="no rest timer running"):
        await workouts.rest(db, user, workout.id, RestIn(delta_s=15))
    workout = await workouts.rest(db, user, workout.id, RestIn(start_s=60))
    assert workout.rest_ends_at == T0 + timedelta(seconds=90)
    workout = await workouts.rest(db, user, workout.id, RestIn(skip=True))
    assert (workout.rest_ends_at, workout.rest_total_s) == (None, None)

    workout = await workouts.uncomplete_set(db, user, workout.id, set_id)
    assert workout.exercises[0].sets[0].completed_at is None


async def test_superset_rest_starts_after_the_round(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    a = await make_exercise(db, name="Zzq A")
    b = await make_exercise(db, name="Zzq B")
    template = await _template(
        db, user,
        {"exercise_id": a.id, "rest_seconds": 30, "superset_group": 1,
         "sets": [{"weight_kg": 10, "reps": 10}]},
        {"exercise_id": b.id, "rest_seconds": 120, "superset_group": 1,
         "sets": [{"weight_kg": 20, "reps": 10}]},
    )
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    a_set = workout.exercises[0].sets[0].id
    b_set = workout.exercises[1].sets[0].id
    workout = await workouts.complete_set(db, user, workout.id, a_set, SetPatch())
    assert workout.rest_ends_at is None
    workout = await workouts.complete_set(db, user, workout.id, b_set, SetPatch())
    assert workout.rest_ends_at == T0 + timedelta(seconds=120)


async def test_zero_rest_starts_no_timer(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    template = await _template(db, user, {
        "exercise_id": squat.id, "rest_seconds": 0, "sets": [{"weight_kg": 80, "reps": 8}],
    })
    workout = await workouts.start_workout(db, user, WorkoutStart(template_id=template.id))
    workout = await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch()
    )
    assert workout.rest_ends_at is None


async def test_workouts_are_private(db, clock) -> None:
    alice = await make_user(db, username="alice", permissions=GYM)
    bob = await make_user(db, username="bob", permissions=GYM)
    workout = await workouts.start_workout(db, alice, WorkoutStart())
    with pytest.raises(NotFound):
        await workouts.get_workout(db, bob, workout.id)
    with pytest.raises(NotFound):
        await workouts.rest(db, bob, workout.id, RestIn(skip=True))
    assert await workouts.get_active(db, bob) is None
