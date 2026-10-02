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


async def test_exercise_progress_metrics_and_personal_records(db) -> None:
    user = await make_user(db, permissions=GYM)
    weighted = await make_exercise(db, name="Progress Squat", tracking=Tracking.weight_reps)
    reps = await make_exercise(db, name="Progress Pushup", tracking=Tracking.reps)
    duration = await make_exercise(db, name="Progress Plank", tracking=Tracking.duration)
    await make_finished_workout(
        db,
        user,
        started_at=datetime(2026, 10, 2, 10, tzinfo=UTC),
        minutes=60,
        items=[
            (weighted, [(100.0, 5, None)]),
            (reps, [(None, 8, None), (None, 12, None)]),
            (duration, [(None, None, 30), (None, None, 45)]),
        ],
    )
    await make_finished_workout(
        db,
        user,
        started_at=datetime(2026, 10, 8, 10, tzinfo=UTC),
        minutes=60,
        items=[
            (weighted, [(105.0, 1, None)]),
            (reps, [(None, 10, None), (None, 9, None)]),
            (duration, [(None, None, 60), (None, None, 30)]),
        ],
    )

    async with await http_client(db, user) as client:
        weight_response = await client.get(
            f"/api/stats/gym/exercises/{weighted.id}",
            params={"start": "2026-10-01", "end": "2026-10-10"},
        )
        reps_response = await client.get(
            f"/api/stats/gym/exercises/{reps.id}",
            params={"start": "2026-10-01", "end": "2026-10-10"},
        )
        duration_response = await client.get(
            f"/api/stats/gym/exercises/{duration.id}",
            params={"start": "2026-10-01", "end": "2026-10-10"},
        )

    weight_progress = weight_response.json()
    assert weight_response.status_code == 200
    assert [session["date"] for session in weight_progress["sessions"]] == [
        "2026-10-08", "2026-10-02"
    ]
    assert [session["metrics"] for session in weight_progress["sessions"]] == [
        {"max_weight_kg": 105.0, "max_1rm_kg": 105.0, "volume_kg": 105.0},
        {"max_weight_kg": 100.0, "max_1rm_kg": 116.7, "volume_kg": 500.0},
    ]
    assert weight_progress["sessions"][1]["sets"] == ["100 kg × 5"]
    assert weight_progress["records"] == [
        {"kind": "max_weight_kg", "value": 105.0, "date": "2026-10-08"},
        {"kind": "max_1rm_kg", "value": 116.7, "date": "2026-10-02"},
        {"kind": "max_reps", "value": 5, "date": "2026-10-02"},
    ]
    assert reps_response.status_code == 200
    assert reps_response.json()["sessions"][1]["metrics"] == {
        "max_reps": 12, "total_reps": 20
    }
    assert reps_response.json()["records"] == [
        {"kind": "max_reps", "value": 12, "date": "2026-10-02"}
    ]
    assert duration_response.status_code == 200
    assert duration_response.json()["sessions"][0]["metrics"] == {
        "max_duration_s": 60, "total_duration_s": 90
    }
    assert duration_response.json()["records"] == [
        {"kind": "max_duration_s", "value": 60, "date": "2026-10-08"}
    ]


async def test_performed_exercises_include_archived_custom_and_exclude_other_workouts(db) -> None:
    alice = await make_user(db, permissions=GYM)
    bob = await make_user(db, username="bob", permissions=GYM)
    archived = await make_exercise(db, name="Archived custom", owner=alice)
    archived.archived_at = datetime(2026, 10, 10, tzinfo=UTC)
    recent = await make_exercise(db, name="Recent catalog")
    bob_exercise = await make_exercise(db, name="Bob custom", owner=bob)
    active = await make_exercise(db, name="Only in progress")
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 1, 10, tzinfo=UTC),
        minutes=30,
        items=[(archived, [(40.0, 5, None)])],
    )
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 5, 10, tzinfo=UTC),
        minutes=30,
        items=[(recent, [(30.0, 5, None)])],
    )
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 3, 10, tzinfo=UTC),
        minutes=30,
        items=[(active, [(30.0, 5, None)])],
        status=WorkoutStatus.in_progress,
    )
    await make_finished_workout(
        db,
        bob,
        started_at=datetime(2026, 10, 8, 10, tzinfo=UTC),
        minutes=30,
        items=[(bob_exercise, [(50.0, 5, None)])],
    )

    async with await http_client(db, alice) as client:
        response = await client.get("/api/stats/gym/exercises")
        progress = await client.get(
            f"/api/stats/gym/exercises/{archived.id}",
            params={"start": "2026-10-01", "end": "2026-10-10"},
        )
        other_custom = await client.get(
            f"/api/stats/gym/exercises/{bob_exercise.id}",
            params={"start": "2026-10-01", "end": "2026-10-10"},
        )

    assert response.status_code == 200
    assert response.json() == [
        {
            "exercise_id": recent.id,
            "name": "Recent catalog",
            "tracking": "weight_reps",
            "custom": False,
            "last_date": "2026-10-05",
        },
        {
            "exercise_id": archived.id,
            "name": "Archived custom",
            "tracking": "weight_reps",
            "custom": True,
            "last_date": "2026-10-01",
        },
    ]
    assert progress.status_code == 200
    assert progress.json()["sessions"][0]["sets"] == ["40 kg × 5"]
    assert other_custom.status_code == 404


async def test_exercise_stats_require_workout_permission_and_login(db) -> None:
    user = await make_user(db)
    async with await http_client(db, user) as client:
        assert (await client.get("/api/stats/gym/exercises")).status_code == 403
        assert (await client.get(
            "/api/stats/gym/exercises/1",
            params={"start": "2026-10-01", "end": "2026-10-02"},
        )).status_code == 403
    async with await http_client() as client:
        assert (await client.get("/api/stats/gym/exercises")).status_code == 401
        assert (await client.get(
            "/api/stats/gym/exercises/1",
            params={"start": "2026-10-01", "end": "2026-10-02"},
        )).status_code == 401
