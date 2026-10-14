"""Version and uuid of workouts: every save bumps the version, uuids stay put (needs Postgres)."""

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.models.push import PushSubscription
from app.models.workout import Workout
from app.schemas.workout import (
    FinishIn,
    SaveAsTemplateIn,
    SetPatch,
    WorkoutExerciseAdd,
    WorkoutStart,
)
from app.services import workouts
from app.services.rest_notifier import PushResult, notify_due_rests
from tests.factories import GYM, http_client, make_exercise, make_user

T0 = datetime(2026, 9, 24, 18, 0, tzinfo=UTC)


async def test_start_workout_begins_at_version_one(db) -> None:
    user = await make_user(db, permissions=GYM)
    started = await workouts.start_workout(db, user, WorkoutStart())
    assert started.version == 1
    assert started.uuid is not None


async def test_granular_endpoints_bump_version_and_keep_uuids(db) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Version Squat")
    async with await http_client(db, user) as client:
        started = (await client.post("/api/workouts", json={})).json()
        assert started["version"] == 1
        workout_id, workout_uuid = started["id"], started["uuid"]

        added = (await client.post(
            f"/api/workouts/{workout_id}/exercises", json={"exercise_id": squat.id}
        )).json()
        assert added["version"] == 2
        item = added["exercises"][0]

        done = (await client.post(
            f"/api/workouts/{workout_id}/sets/{item['sets'][0]['id']}/complete",
            json={"weight_kg": 80, "reps": 8},
        )).json()
        assert done["version"] == 3
        assert done["uuid"] == workout_uuid
        assert done["exercises"][0]["uuid"] == item["uuid"]
        assert done["exercises"][0]["sets"][0]["uuid"] == item["sets"][0]["uuid"]

        more = (await client.post(
            f"/api/workouts/{workout_id}/exercises/{item['id']}/sets"
        )).json()
        assert more["version"] == 4
        new_sets = more["exercises"][0]["sets"]
        assert new_sets[0]["uuid"] == item["sets"][0]["uuid"]
        assert new_sets[1]["uuid"] != item["sets"][0]["uuid"]


async def test_due_rest_notification_keeps_version(db, monkeypatch) -> None:
    monkeypatch.setattr(workouts, "now", lambda: T0)
    user = await make_user(db, permissions=GYM)
    exercise = await make_exercise(db, name="Zzq Version Notifier")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=exercise.id)
    )
    workout = await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=80, reps=8)
    )
    assert workout.version == 3
    db.add(PushSubscription(
        user_id=user.id, endpoint="https://fcm.googleapis.com/version", p256dh="key", auth="auth",
    ))
    await db.flush()

    async def sender(subscription: dict, payload: str) -> PushResult:
        return PushResult.sent

    assert await notify_due_rests(sender, T0 + timedelta(seconds=91)) == 1
    stored = await db.scalar(sa.select(Workout.version).where(Workout.id == workout.id))
    assert stored == 3


async def test_save_as_template_bumps_version(db) -> None:
    user = await make_user(db, permissions=GYM)
    exercise = await make_exercise(db, name="Zzq Version Row")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=exercise.id)
    )
    workout = await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=60, reps=5)
    )
    finished = await workouts.finish_workout(db, user, workout.id, FinishIn())
    assert finished.version == 4

    await workouts.save_as_template(db, user, workout.id, SaveAsTemplateIn(name="Da test"))
    stored = await db.scalar(sa.select(Workout.version).where(Workout.id == workout.id))
    assert stored == 5
