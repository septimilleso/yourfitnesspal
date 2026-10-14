"""`GET /api/workouts/offline-snapshot`: Precedente and Max for offline use (R7, C10).

The schema, route order, permission and pure builder checks run without Postgres;
the HTTP checks (C10, isolation, 403) need the remote test database.
"""

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app import main
from app.models.exercise import Exercise, Tracking
from app.models.user import Role, User
from app.models.workout import TemplateExercise, WorkoutTemplate
from app.schemas.workout import OfflineSnapshot, SetValues, SnapshotExercise
from app.services import workouts
from app.services.errors import PermissionMissing
from app.services.workouts import Previous
from tests.factories import GYM, http_client, make_exercise, make_finished_workout, make_user

T0 = datetime(2026, 10, 14, 10, 0, tzinfo=UTC)


@pytest.fixture
def clock(monkeypatch):
    """Freeze `workouts.now()` at T0 so the 90-day window is deterministic."""
    monkeypatch.setattr(workouts, "now", lambda: T0)


def _squat() -> Exercise:
    return Exercise(
        id=7, source="catalog", owner_user_id=None, name="Squat", equipment="barbell",
        primary_muscles=["quadriceps"], secondary_muscles=[], category="strength",
        instructions=[], tracking=Tracking.weight_reps,
    )


# --- DB-free -------------------------------------------------------------------------

def test_snapshot_schema_names_the_fields_the_client_reads() -> None:
    assert set(OfflineSnapshot.model_fields) == {"server_now", "exercises"}
    assert set(SnapshotExercise.model_fields) == {"exercise", "rest_seconds", "previous", "max"}


def test_snapshot_serializes_to_the_documented_json_shape() -> None:
    entry = workouts.snapshot_entry(_squat(), None, None)
    body = OfflineSnapshot(server_now=T0, exercises=[entry]).model_dump(mode="json")
    assert set(body) == {"server_now", "exercises"}
    assert body["exercises"][0]["rest_seconds"] is None
    assert body["exercises"][0]["previous"] == []
    assert body["exercises"][0]["max"] == []
    assert body["exercises"][0]["exercise"]["name"] == "Squat"


def test_snapshot_rest_must_fit_the_rest_seconds_range() -> None:
    with pytest.raises(ValidationError):
        SnapshotExercise(
            exercise=workouts.snapshot_entry(_squat(), None, None).exercise,
            rest_seconds=-1, previous=[], max=[],
        )


def test_snapshot_entry_without_history_has_no_rest_and_no_sets() -> None:
    entry = workouts.snapshot_entry(_squat(), None, None)
    assert entry.rest_seconds is None
    assert entry.previous == []
    assert entry.max == []


def test_snapshot_entry_takes_rest_previous_and_max_from_the_history() -> None:
    previous = Previous(rest_seconds=120, sets=[SetValues(weight_kg=80, reps=8)])
    best = [SetValues(weight_kg=85, reps=8), SetValues(weight_kg=80, reps=6)]
    entry = workouts.snapshot_entry(_squat(), previous, best)
    assert entry.rest_seconds == 120
    assert entry.previous == previous.sets
    assert entry.max == best
    assert entry.exercise.id == 7
    assert entry.exercise.custom is False


def test_snapshot_route_is_declared_before_the_workout_id_route() -> None:
    get_paths = [
        route.path for route in main.app.routes if "GET" in getattr(route, "methods", set())
    ]
    assert "/api/workouts/offline-snapshot" in get_paths
    assert get_paths.index("/api/workouts/offline-snapshot") < get_paths.index(
        "/api/workouts/{workout_id}"
    )


async def test_snapshot_refuses_a_user_without_the_workouts_permission() -> None:
    user = User(username="bob", role=Role.user, permissions=[])
    with pytest.raises(PermissionMissing):
        await workouts.offline_snapshot(None, user)


# --- DB-backed (remote test database) ------------------------------------------------

async def test_snapshot_matches_what_a_new_workout_shows(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Squat")
    bench = await make_exercise(db, name="Zzq Bench")
    lat = await make_exercise(db, name="Zzq Lat Pull")
    db.add(WorkoutTemplate(
        user_id=user.id, name="Giorno 1", position=0,
        exercises=[TemplateExercise(exercise=squat, position=0)],
    ))
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=10), minutes=50,
        items=[(bench, [(85, 8, None)])],
    )
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=3), minutes=50,
        items=[(bench, [(80, 8, None), (80, 8, None)])],
    )
    # Older than 90 days: its exercise must not be in the snapshot.
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=120), minutes=40,
        items=[(lat, [(50, 10, None)])],
    )
    async with await http_client(db, user) as client:
        response = await client.get("/api/workouts/offline-snapshot")
        assert response.status_code == 200
        body = response.json()
        assert "server_now" in body
        by_name = {entry["exercise"]["name"]: entry for entry in body["exercises"]}
        assert set(by_name) == {"Zzq Squat", "Zzq Bench"}

        assert by_name["Zzq Squat"]["previous"] == []
        assert by_name["Zzq Squat"]["max"] == []
        assert by_name["Zzq Squat"]["rest_seconds"] is None

        bench_entry = by_name["Zzq Bench"]
        assert bench_entry["previous"] == [
            {"weight_kg": 80.0, "reps": 8, "duration_s": None},
            {"weight_kg": 80.0, "reps": 8, "duration_s": None},
        ]
        assert bench_entry["max"] == [
            {"weight_kg": 85.0, "reps": 8, "duration_s": None},
            {"weight_kg": 80.0, "reps": 8, "duration_s": None},
        ]
        assert bench_entry["rest_seconds"] == 90

        # The same exercise in a new workout shows the same Precedente and Max per set.
        started = await client.post("/api/workouts", json={})
        workout_id = started.json()["id"]
        await client.post(f"/api/workouts/{workout_id}/exercises", json={"exercise_id": bench.id})
        active = (await client.get("/api/workouts/active")).json()
        item = next(entry for entry in active["exercises"] if entry["exercise"]["id"] == bench.id)
        assert len(item["sets"]) == 2
        assert [s["previous"] for s in item["sets"]] == bench_entry["previous"]
        assert [s["max_set"] for s in item["sets"]] == bench_entry["max"]
        assert item["rest_seconds"] == bench_entry["rest_seconds"]


async def test_snapshot_shows_only_the_callers_data(db, clock) -> None:
    alice = await make_user(db, username="alice", permissions=GYM)
    bob = await make_user(db, username="bob", permissions=GYM)
    bench = await make_exercise(db, name="Zzq Bench")
    custom = await make_exercise(db, name="Zzq Custom Row", owner=alice)
    squat = await make_exercise(db, name="Zzq Squat")
    await make_finished_workout(
        db, alice, started_at=T0 - timedelta(days=2), minutes=40,
        items=[(bench, [(100, 5, None)]), (custom, [(20, 12, None)])],
    )
    await make_finished_workout(
        db, bob, started_at=T0 - timedelta(days=1), minutes=40,
        items=[(squat, [(60, 5, None)])],
    )
    async with await http_client(db, bob) as client:
        body = (await client.get("/api/workouts/offline-snapshot")).json()
    assert [entry["exercise"]["name"] for entry in body["exercises"]] == ["Zzq Squat"]
    assert body["exercises"][0]["previous"] == [{"weight_kg": 60.0, "reps": 5, "duration_s": None}]


async def test_snapshot_forbidden_without_the_workouts_permission(db) -> None:
    user = await make_user(db, permissions=[])
    async with await http_client(db, user) as client:
        response = await client.get("/api/workouts/offline-snapshot")
    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}
