"""Gym tools over the in-memory MCP transport (needs Postgres)."""

import sqlalchemy as sa

from app.models.user import AuditEvent
from app.schemas.workout import FinishIn, SetPatch, WorkoutExerciseAdd, WorkoutStart
from app.services import workouts
from tests.factories import make_exercise, make_user
from tests.mcp_helpers import call, call_error, mcp_client

BOTH = ["mcp.access", "workouts.use"]


async def test_search_and_create_template(db) -> None:
    user = await make_user(db, permissions=BOTH)
    squat = await make_exercise(db, name="Zzq Squat")
    async with mcp_client(user) as client:
        found = await call(client, "search_exercises", query="Zzq Squat")
        assert found["exercises"][0] == {
            "exercise_id": squat.id, "name": "Zzq Squat", "equipment": "barbell",
            "primary_muscles": ["quadriceps"], "tracking": "weight_reps", "custom": False,
        }
        created = await call(client, "create_workout_template", name="Giorno 1",
                             folder="Settimana 1", exercises=[{
                                 "exercise_id": squat.id, "rest_seconds": 120,
                                 "sets": [{"weight_kg": 80, "reps": 8}] * 3,
                             }])
        assert created["name"] == "Giorno 1"
        assert created["exercises"][0]["sets"] == [
            {"weight_kg": 80.0, "reps": 8, "duration_s": None}
        ] * 3
        again = await call(client, "create_workout_template", name="Giorno 2",
                           folder="settimana 1", exercises=[{
                               "exercise_id": squat.id, "sets": [{"weight_kg": 60, "reps": 10}],
                           }])
        listing = await call(client, "list_workout_templates")
        detail = await call(client, "get_workout_template", template_id=again["template_id"])
    assert [f["name"] for f in listing["folders"]] == ["Settimana 1"]
    assert {t["name"] for t in listing["templates"]} == {"Giorno 1", "Giorno 2"}
    assert all(t["folder"] == "Settimana 1" for t in listing["templates"])
    assert detail["exercises"][0]["rest_seconds"] == 90
    audit = (await db.scalars(sa.select(AuditEvent).where(
        AuditEvent.action == "mcp.create_workout_template"))).all()
    assert len(audit) == 2


async def test_workout_history_tools(db) -> None:
    user = await make_user(db, permissions=BOTH)
    squat = await make_exercise(db, name="Zzq Squat")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=squat.id)
    )
    await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=60, reps=5)
    )
    await workouts.finish_workout(db, user, workout.id, FinishIn())
    async with mcp_client(user) as client:
        listed = await call(client, "list_workouts")
        detail = await call(client, "get_workout", workout_id=workout.id)
    assert listed["workouts"][0]["workout_id"] == workout.id
    assert listed["workouts"][0]["exercises"] == [{"name": "Zzq Squat", "sets": 1}]
    assert detail["exercises"][0]["sets"] == ["60 kg × 5"]


async def test_gym_tools_need_the_workouts_permission(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        message = await call_error(client, "list_workout_templates")
    assert "workouts.use" in message
