"""Constraints on the gym tables (needs Postgres)."""

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.models.exercise import Exercise, Tracking
from app.models.user import User
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus
from tests.factories import make_exercise, make_user


async def test_custom_exercise_needs_owner(db) -> None:
    db.add(Exercise(
        source="custom", name="Orphan", primary_muscles=[], secondary_muscles=[],
        instructions=[], tracking=Tracking.reps,
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_only_one_workout_in_progress_per_user(db) -> None:
    user = await make_user(db)
    now = datetime.now(UTC)
    db.add(Workout(user_id=user.id, name="A", status=WorkoutStatus.in_progress, started_at=now))
    await db.flush()
    db.add(Workout(user_id=user.id, name="B", status=WorkoutStatus.finished, started_at=now))
    await db.flush()
    db.add(Workout(user_id=user.id, name="C", status=WorkoutStatus.in_progress, started_at=now))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_deleting_user_cascades_through_workouts_and_custom_exercises(db) -> None:
    user = await make_user(db)
    custom = await make_exercise(db, name="Zzq Custom", owner=user)
    workout = Workout(
        user_id=user.id, name="A", status=WorkoutStatus.finished,
        started_at=datetime.now(UTC),
        exercises=[WorkoutExercise(
            exercise_id=custom.id, position=0, rest_seconds=90,
            sets=[WorkoutSet(position=0, reps=5)],
        )],
    )
    db.add(workout)
    await db.flush()
    await db.execute(sa.delete(User).where(User.id == user.id))
    assert await db.scalar(sa.select(sa.func.count()).select_from(Workout).where(
        Workout.user_id == user.id)) == 0
    assert await db.get(Exercise, custom.id, populate_existing=True) is None
