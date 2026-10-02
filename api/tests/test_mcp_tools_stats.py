from datetime import UTC, date, datetime

from app.models.exercise import Tracking
from app.models.weight import BodyWeight
from tests.factories import http_client, make_exercise, make_finished_workout, make_user
from tests.mcp_helpers import call, call_error, mcp_client

MCP_AND_GYM = ["mcp.access", "workouts.use"]


async def test_weight_and_gym_tools_match_rest_and_are_user_scoped(db) -> None:
    alice = await make_user(db, permissions=MCP_AND_GYM)
    bob = await make_user(db, username="bob", permissions=MCP_AND_GYM)
    exercise = await make_exercise(db, name="MCP Stats Squat", tracking=Tracking.weight_reps)
    db.add_all([
        BodyWeight(user_id=alice.id, date=date(2026, 10, 2), weight_kg=72.4),
        BodyWeight(user_id=bob.id, date=date(2026, 10, 2), weight_kg=99.9),
    ])
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 2, 10, tzinfo=UTC),
        minutes=60,
        items=[(exercise, [(80.0, 5, None)])],
    )
    await make_finished_workout(
        db,
        bob,
        started_at=datetime(2026, 10, 2, 10, tzinfo=UTC),
        minutes=90,
        items=[(exercise, [(999.0, 99, None)])],
    )
    await db.flush()

    period = {"start": "2026-10-01", "end": "2026-10-07"}
    async with await http_client(db, alice) as http:
        rest_weights = await http.get("/api/weights", params=period)
        rest_gym_stats = await http.get("/api/stats/gym", params=period)
    async with mcp_client(alice) as client:
        mcp_weights = await call(client, "get_weight_history", **period)
        mcp_gym_stats = await call(client, "get_gym_stats", **period)
        mcp_progress = await call(
            client,
            "get_exercise_progress",
            exercise_id=exercise.id,
            **period,
        )

    assert rest_weights.status_code == rest_gym_stats.status_code == 200
    assert mcp_weights == rest_weights.json()
    assert mcp_gym_stats == rest_gym_stats.json()
    assert mcp_weights["days"][1]["weight_kg"] == 72.4
    assert "99.9" not in str(mcp_weights)
    assert mcp_gym_stats["workouts"] == 1
    assert mcp_gym_stats["volume_kg"] == 400.0
    assert mcp_progress["sessions"][0]["metrics"]["max_weight_kg"] == 80.0
    assert "999" not in str(mcp_progress)


async def test_mcp_stats_defaults_and_rejects_long_period(db, monkeypatch) -> None:
    user = await make_user(db, permissions=MCP_AND_GYM)
    monkeypatch.setattr("app.mcp.tools.stats.today", lambda: date(2026, 10, 2))
    exercise = await make_exercise(db, name="MCP Defaults Squat")
    await make_finished_workout(
        db,
        user,
        started_at=datetime(2026, 10, 2, 10, tzinfo=UTC),
        minutes=45,
        items=[(exercise, [(50.0, 5, None)])],
    )

    async with mcp_client(user) as client:
        history = await call(client, "get_weight_history")
        gym = await call(client, "get_gym_stats")
        progress = await call(client, "get_exercise_progress", exercise_id=exercise.id)
        long_history_error = await call_error(
            client, "get_weight_history", start="2025-10-01", end="2026-10-02"
        )
        long_gym_error = await call_error(
            client, "get_gym_stats", start="2025-10-01", end="2026-10-02"
        )

    assert history["start"] == gym["start"] == "2026-09-03"
    assert history["end"] == gym["end"] == "2026-10-02"
    assert progress["start"] == "2026-07-05"
    assert progress["end"] == "2026-10-02"
    assert "366" in long_history_error
    assert "366" in long_gym_error


async def test_gym_stats_tools_require_workout_permission(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        gym_error = await call_error(client, "get_gym_stats")
        progress_error = await call_error(
            client,
            "get_exercise_progress",
            exercise_id=1,
            start="2026-10-02",
            end="2026-10-01",
        )
        history = await call(client, "get_weight_history")

    assert "workouts.use" in gym_error
    assert "workouts.use" in progress_error
    assert history["end"] >= history["start"]


async def test_exercise_progress_returns_sessions_records_and_hides_other_custom(db) -> None:
    alice = await make_user(db, permissions=MCP_AND_GYM)
    bob = await make_user(db, username="bob", permissions=MCP_AND_GYM)
    weighted = await make_exercise(db, name="MCP Progress Squat", tracking=Tracking.weight_reps)
    bob_custom = await make_exercise(db, name="Bob MCP custom", owner=bob)
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 2, 10, tzinfo=UTC),
        minutes=60,
        items=[(weighted, [(100.0, 5, None)])],
    )
    await make_finished_workout(
        db,
        alice,
        started_at=datetime(2026, 10, 8, 10, tzinfo=UTC),
        minutes=60,
        items=[(weighted, [(105.0, 1, None)])],
    )
    await make_finished_workout(
        db,
        bob,
        started_at=datetime(2026, 10, 8, 10, tzinfo=UTC),
        minutes=60,
        items=[(bob_custom, [(500.0, 10, None)])],
    )

    async with mcp_client(alice) as client:
        result = await call(
            client,
            "get_exercise_progress",
            exercise_id=weighted.id,
            start="2026-10-01",
            end="2026-10-10",
        )
        not_found = await call_error(
            client,
            "get_exercise_progress",
            exercise_id=bob_custom.id,
            start="2026-10-01",
            end="2026-10-10",
        )

    assert result["name"] == "MCP Progress Squat"
    assert [session["metrics"]["max_1rm_kg"] for session in result["sessions"]] == [105.0, 116.7]
    assert result["records"] == [
        {"kind": "max_weight_kg", "value": 105.0, "date": "2026-10-08"},
        {"kind": "max_1rm_kg", "value": 116.7, "date": "2026-10-02"},
        {"kind": "max_reps", "value": 5, "date": "2026-10-02"},
    ]
    assert "not found" in not_found.lower()
    assert "500" not in not_found


async def test_stats_mcp_registers_only_read_tools_for_weight_and_workouts(db) -> None:
    user = await make_user(db, permissions=MCP_AND_GYM)
    async with mcp_client(user) as client:
        tools = (await client.list_tools()).tools

    names = {tool.name for tool in tools}
    assert {"get_weight_history", "get_gym_stats", "get_exercise_progress"} <= names
    assert "log_weight" not in names
    assert "delete_workout" not in names
    assert {name for name in names if "weight" in name} == {"get_weight_history"}
    # Existing diary tools include delete_diary_entry; only gym/weight write tools are excluded.
