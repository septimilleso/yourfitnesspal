from datetime import UTC, datetime

from app.config import settings
from app.models.exercise import Tracking
from app.models.workout import WorkoutStatus
from tests.factories import GYM, http_client, make_exercise, make_finished_workout, make_user


async def test_period_stats_count_volume_duration_and_weekly_frequency(db) -> None:
    alice = await make_user(db, permissions=GYM)
    bob = await make_user(db, username="bob", permissions=GYM)
    weighted = await make_exercise(db, name="Stats Squat", tracking=Tracking.weight_reps)
    reps = await make_exercise(db, name="Stats Pushup", tracking=Tracking.reps)
    duration = await make_exercise(db, name="Stats Plank", tracking=Tracking.duration)
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 2, 10, tzinfo=UTC),
        minutes=60,
        items=[
            (weighted, [(100.0, 5, None)]),
            (reps, [(None, 12, None)]),
            (duration, [(None, None, 45)]),
        ],
    )
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 8, 10, tzinfo=UTC),
        minutes=90,
        items=[(weighted, [(80.0, 8, None)])],
    )
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 9, 10, tzinfo=UTC),
        minutes=15,
        items=[(weighted, [(999.0, 99, None)])],
        status=WorkoutStatus.in_progress,
    )
    await make_finished_workout(
        db,
        bob,
        started_at=datetime(2026, 10, 9, 10, tzinfo=UTC),
        minutes=120,
        items=[(weighted, [(888.0, 88, None)])],
    )

    async with await http_client(db, alice) as client:
        response = await client.get(
            "/api/stats/gym", params={"start": "2026-09-28", "end": "2026-10-18"}
        )
        count = await client.get("/api/stats/gym/count")

    assert response.status_code == 200
    assert response.json() == {
        "start": "2026-09-28",
        "end": "2026-10-18",
        "workouts": 2,
        "volume_kg": 1140.0,
        "avg_duration_min": 75,
        "weeks": [
            {"week_start": "2026-09-28", "workouts": 1},
            {"week_start": "2026-10-05", "workouts": 1},
            {"week_start": "2026-10-12", "workouts": 0},
        ],
    }
    assert count.status_code == 200
    assert count.json() == {"finished": 2}


async def test_period_stats_uses_local_started_day(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "app_timezone", "Europe/Rome")
    user = await make_user(db, permissions=GYM)
    exercise = await make_exercise(db, name="Local day lift")
    await make_finished_workout(
        db,
        user,
        started_at=datetime(2026, 9, 30, 23, 30, tzinfo=UTC),
        minutes=60,
        items=[(exercise, [(50.0, 5, None)])],
    )

    async with await http_client(db, user) as client:
        response = await client.get(
            "/api/stats/gym", params={"start": "2026-10-01", "end": "2026-10-01"}
        )

    assert response.status_code == 200
    assert response.json() == {
        "start": "2026-10-01",
        "end": "2026-10-01",
        "workouts": 1,
        "volume_kg": 250.0,
        "avg_duration_min": 60,
        "weeks": [{"week_start": "2026-09-28", "workouts": 1}],
    }


async def test_gym_stats_rejects_invalid_period(db) -> None:
    user = await make_user(db, permissions=GYM)
    async with await http_client(db, user) as client:
        inverted = await client.get(
            "/api/stats/gym", params={"start": "2026-10-02", "end": "2026-10-01"}
        )
        too_long = await client.get(
            "/api/stats/gym", params={"start": "2025-10-01", "end": "2026-10-02"}
        )
    assert inverted.status_code == 400
    assert too_long.status_code == 400


async def test_gym_stats_requires_workout_permission_and_login(db) -> None:
    user = await make_user(db)
    async with await http_client(db, user) as client:
        assert (await client.get("/api/stats/gym/count")).status_code == 403
        assert (await client.get(
            "/api/stats/gym", params={"start": "2026-10-01", "end": "2026-10-02"}
        )).status_code == 403
    async with await http_client() as client:
        assert (await client.get("/api/stats/gym/count")).status_code == 401
        assert (await client.get(
            "/api/stats/gym", params={"start": "2026-10-01", "end": "2026-10-02"}
        )).status_code == 401
