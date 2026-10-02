"""Test data builders shared by the MCP/OAuth test modules."""

from datetime import datetime, timedelta
from typing import ClassVar

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password
from app.auth.sessions import create_session
from app.main import app
from app.models.exercise import Exercise, Tracking
from app.models.food import Food
from app.models.user import Role, User
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus

PASSWORD = "correct horse battery staple"

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


class _FakeRequest:
    headers: ClassVar[dict] = {}
    client = None


async def make_user(
    db: AsyncSession,
    *,
    username: str = "alice",
    role: Role = Role.user,
    permissions: list[str] | None = None,
) -> User:
    user = User(
        username=username, display_name=username.title(), role=role,
        permissions=permissions if permissions is not None else [],
        password_hash=hash_password(PASSWORD), must_change_password=False, totp_enabled=True,
    )
    db.add(user)
    await db.flush()
    return user


async def make_food(
    db: AsyncSession, *, name: str = "Pasta", brand: str | None = None, owner: User | None = None
) -> Food:
    food = Food(
        source="custom" if owner else "off", owner_user_id=owner.id if owner else None,
        name=name, brand=brand, nutriments=dict(NUTRIMENTS), raw=None,
    )
    db.add(food)
    await db.flush()
    return food


GYM = ["workouts.use"]


async def make_exercise(
    db: AsyncSession,
    *,
    name: str = "Test Squat",
    tracking: Tracking = Tracking.weight_reps,
    owner: User | None = None,
    equipment: str | None = "barbell",
    muscle: str = "quadriceps",
) -> Exercise:
    """A catalog exercise, or a custom one owned by `owner`.

    Tests use made-up names (e.g. "Zzq Press") so they never collide with the
    876 real catalog rows the data migration loads into the test database.
    """
    exercise = Exercise(
        source="custom" if owner else "catalog",
        source_id=None if owner else f"test-{name}",
        owner_user_id=owner.id if owner else None,
        name=name, equipment=equipment, primary_muscles=[muscle], secondary_muscles=[],
        category="strength", instructions=[], tracking=tracking,
    )
    db.add(exercise)
    await db.flush()
    return exercise


async def make_finished_workout(
    db: AsyncSession,
    user: User,
    *,
    started_at: datetime,
    minutes: int,
    items: list[tuple[Exercise, list[tuple[float | None, int | None, int | None]]]],
    status: WorkoutStatus = WorkoutStatus.finished,
) -> Workout:
    finished_at = started_at + timedelta(minutes=minutes) if status is WorkoutStatus.finished else None
    workout = Workout(
        user_id=user.id,
        name="Test workout",
        status=status,
        started_at=started_at,
        finished_at=finished_at,
        exercises=[
            WorkoutExercise(
                exercise=exercise,
                position=position,
                sets=[
                    WorkoutSet(
                        position=set_position,
                        weight_kg=weight,
                        reps=reps,
                        duration_s=duration,
                        completed_at=started_at,
                    )
                    for set_position, (weight, reps, duration) in enumerate(sets)
                ],
            )
            for position, (exercise, sets) in enumerate(items)
        ],
    )
    db.add(workout)
    await db.flush()
    return workout


async def http_client(
    db: AsyncSession | None = None, user: User | None = None, *, csrf: bool = True
) -> AsyncClient:
    """An https client for the ASGI app, optionally logged in as `user`.

    `csrf=False` sends a wrong `X-Requested-With`, to exercise the CSRF gate.
    """
    client = AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test",
        headers={"X-Requested-With": "yfp" if csrf else "nope"},
    )
    if user is not None:
        assert db is not None
        client.cookies.set("session", await create_session(db, user, _FakeRequest()))
    return client
