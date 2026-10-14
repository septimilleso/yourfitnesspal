"""`PUT /api/workouts/{uuid}`: create and replace a whole workout (needs Postgres, except the schema checks)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.models.workout import Workout, WorkoutSet
from app.schemas.workout import TemplateIn, WorkoutPutIn, WorkoutPutSet
from app.services import templates, workouts
from app.services.errors import Invalid
from tests.factories import GYM, http_client, make_exercise, make_finished_workout, make_user

T0 = datetime(2026, 9, 24, 18, 0, tzinfo=UTC)


@pytest.fixture
def clock(monkeypatch):
    """Freeze `workouts.now()` at T0 so the R6 clamp is deterministic."""
    monkeypatch.setattr(workouts, "now", lambda: T0)


def _body(**overrides) -> dict:
    body = {
        "base_version": None, "name": "Giorno 1", "template_id": None, "status": "in_progress",
        "started_at": T0.isoformat(), "finished_at": None, "rest_ends_at": None,
        "rest_total_s": None, "exercises": [],
    }
    body.update(overrides)
    return body


def _item(exercise_id: int, sets: list[dict], *, uuid: UUID | None = None, **extra) -> dict:
    return {
        "uuid": str(uuid or uuid4()), "exercise_id": exercise_id, "rest_seconds": 90,
        "superset_group": None, "note": None, "sets": sets, **extra,
    }


def _set(weight: float | None = None, reps: int | None = None, *, done: bool = False,
         duration: int | None = None, uuid: UUID | None = None) -> dict:
    return {
        "uuid": str(uuid or uuid4()), "weight_kg": weight, "reps": reps, "duration_s": duration,
        "completed_at": T0.isoformat() if done else None,
    }


# --- schema, DB-free -------------------------------------------------------------------

def test_put_weight_is_rounded_to_two_decimals_like_the_column() -> None:
    assert WorkoutPutSet(uuid=uuid4(), weight_kg=80.005).weight_kg == 80.01
    assert WorkoutPutSet(uuid=uuid4(), weight_kg=80.004).weight_kg == 80.0
    assert WorkoutPutSet(uuid=uuid4(), weight_kg=None).weight_kg is None


def test_put_finished_at_follows_the_status() -> None:
    with pytest.raises(ValidationError, match="finished_at is required"):
        WorkoutPutIn.model_validate(_body(status="finished"))
    with pytest.raises(ValidationError, match="must be null"):
        WorkoutPutIn.model_validate(_body(finished_at=T0.isoformat()))
    body = WorkoutPutIn.model_validate(_body(status="finished", finished_at=T0.isoformat()))
    assert body.finished_at == T0


def test_put_rejects_naive_datetimes() -> None:
    with pytest.raises(ValidationError):
        WorkoutPutIn.model_validate(_body(started_at="2026-09-24T18:00:00"))


def test_put_rejects_a_repeated_exercise_uuid() -> None:
    twin = uuid4()
    with pytest.raises(ValidationError, match="exercise uuid repeated"):
        WorkoutPutIn.model_validate(_body(exercises=[_item(1, [], uuid=twin), _item(2, [], uuid=twin)]))


def test_put_rejects_a_set_uuid_repeated_across_exercises() -> None:
    twin = uuid4()
    with pytest.raises(ValidationError, match="set uuid repeated"):
        WorkoutPutIn.model_validate(_body(exercises=[
            _item(1, [_set(10, 10, uuid=twin)]), _item(2, [_set(10, 10, uuid=twin)]),
        ]))


def test_put_ids_fit_the_database_integers() -> None:
    with pytest.raises(ValidationError):
        WorkoutPutIn.model_validate(_body(template_id=2**31))
    with pytest.raises(ValidationError):
        WorkoutPutIn.model_validate(_body(exercises=[_item(2**31, [])]))


def test_put_limits_exercises_and_sets() -> None:
    too_many_exercises = [_item(1, []) for _ in range(101)]
    with pytest.raises(ValidationError):
        WorkoutPutIn.model_validate(_body(exercises=too_many_exercises))
    too_many_sets = [_set(10, 10) for _ in range(101)]
    with pytest.raises(ValidationError):
        WorkoutPutIn.model_validate(_body(exercises=[_item(1, too_many_sets)]))


# --- C3: create, then replace by uuid ---------------------------------------------------

async def test_put_creates_then_replaces_by_uuid(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Put Squat")
    workout_uuid, item_uuid = uuid4(), uuid4()
    first, second, third = uuid4(), uuid4(), uuid4()
    created_body = _body(exercises=[_item(squat.id, [
        _set(80, 8, uuid=first), _set(80, 8, uuid=second),
    ], uuid=item_uuid)])
    async with await http_client(db, user) as client:
        created = await client.put(f"/api/workouts/{workout_uuid}", json=created_body)
        assert created.status_code == 201
        assert created.json()["version"] == 1
        assert created.json()["uuid"] == str(workout_uuid)

        active = (await client.get("/api/workouts/active")).json()
        [item] = active["exercises"]
        assert item["uuid"] == str(item_uuid)
        assert [s["uuid"] for s in item["sets"]] == [str(first), str(second)]
        item_id, kept_id, dropped_id = item["id"], item["sets"][1]["id"], item["sets"][0]["id"]

        replaced = await client.put(f"/api/workouts/{workout_uuid}", json=_body(
            base_version=1, exercises=[_item(squat.id, [
                _set(80, 8, uuid=second), _set(82.5, 6, uuid=third),
            ], uuid=item_uuid)],
        ))
        assert replaced.status_code == 200
        assert replaced.json()["version"] == 2
        [replaced_item] = replaced.json()["exercises"]
        assert replaced_item["id"] == item_id
        kept, added = replaced_item["sets"]
        assert kept["id"] == kept_id
        assert added["uuid"] == str(third)
        assert added["weight_kg"] == 82.5

    gone = await db.scalar(sa.select(WorkoutSet.id).where(WorkoutSet.id == dropped_id))
    assert gone is None


# --- C4: validation, ownership and template ownership -----------------------------------

async def test_put_checks_sets_visibility_and_template_ownership(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    other = await make_user(db, username="bob", permissions=GYM)
    squat = await make_exercise(db, name="Zzq Put Checks")
    foreign = await make_exercise(db, name="Zzq Put Foreign", owner=other)
    async with await http_client(db, user) as client:
        # a completed weight_reps set without reps: 400, nothing saved
        missing = await client.put(f"/api/workouts/{uuid4()}", json=_body(
            exercises=[_item(squat.id, [_set(80, None, done=True)])],
        ))
        assert missing.status_code == 400
        assert missing.json()["detail"] == "weight and reps are required"
        count = await db.scalar(
            sa.select(sa.func.count()).select_from(Workout).where(Workout.user_id == user.id)
        )
        assert count == 0

        # a custom exercise of another user: 404
        hidden = await client.put(f"/api/workouts/{uuid4()}", json=_body(
            exercises=[_item(foreign.id, [_set(80, 8)])],
        ))
        assert hidden.status_code == 404

        # a template the user does not own is saved as null
        saved = await client.put(f"/api/workouts/{uuid4()}", json=_body(template_id=999999))
        assert saved.status_code == 201
        assert saved.json()["template_id"] is None


async def test_put_from_own_template_sets_its_last_use(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Put Template")
    template = await templates.create_template(db, user, TemplateIn.model_validate({
        "name": "Giorno 1",
        "exercises": [{"exercise_id": squat.id, "sets": [{"weight_kg": 80, "reps": 8}]}],
    }))
    async with await http_client(db, user) as client:
        response = await client.put(f"/api/workouts/{uuid4()}", json=_body(
            template_id=template.id,
            exercises=[_item(squat.id, [_set(80, 8)])],
        ))
    assert response.status_code == 201
    assert response.json()["template_id"] == template.id
    stored = await templates.get_template(db, user, template.id)
    assert stored.last_used_at == T0


# --- C5: finishing through the PUT ------------------------------------------------------

async def test_put_finished_prunes_and_diffs_against_the_template(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Put Finish Squat")
    bench = await make_exercise(db, name="Zzq Put Finish Bench")
    template = await templates.create_template(db, user, TemplateIn.model_validate({
        "name": "Giorno 1",
        "exercises": [{"exercise_id": squat.id, "rest_seconds": 90, "sets": [
            {"weight_kg": 80, "reps": 8}, {"weight_kg": 80, "reps": 8},
        ]}],
    }))
    workout_uuid = uuid4()
    async with await http_client(db, user) as client:
        # nothing done: the whole workout is refused
        empty = await client.put(f"/api/workouts/{uuid4()}", json=_body(
            status="finished", finished_at=(T0 + timedelta(minutes=1)).isoformat(),
            exercises=[_item(squat.id, [_set(80, 8)])],
        ))
        assert empty.status_code == 400
        assert empty.json()["detail"] == "empty_workout"

        response = await client.put(f"/api/workouts/{workout_uuid}", json=_body(
            template_id=template.id, status="finished",
            finished_at=(T0 + timedelta(minutes=1)).isoformat(),
            rest_ends_at=(T0 + timedelta(seconds=60)).isoformat(), rest_total_s=60,
            exercises=[
                _item(squat.id, [
                    _set(80, 8, done=True), _set(75, 8, done=True), _set(70, 6),
                ]),
                _item(bench.id, [_set(60, 5), _set(60, 5)]),
            ],
        ))
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "finished"
    assert body["finished_at"] is not None
    assert body["rest_ends_at"] is None and body["rest_total_s"] is None
    [item] = body["exercises"]
    assert [(s["weight_kg"], s["reps"]) for s in item["sets"]] == [(80, 8), (75, 8)]
    assert body["template_diff"] == ["Zzq Put Finish Squat: serie 2 80 kg × 8 → 75 kg × 8"]


# --- C43: previous and max_set equal to a workout started with POST --------------------

async def test_put_workout_gets_the_same_previous_and_max_as_a_started_one(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Put Parity")
    await make_finished_workout(
        db, user, started_at=T0 - timedelta(days=2), minutes=50,
        items=[(squat, [(70, 10, None), (75, 8, None)])],
    )
    async with await http_client(db, user) as client:
        put = (await client.put(f"/api/workouts/{uuid4()}", json=_body(
            exercises=[_item(squat.id, [_set(60, 5), _set(60, 5)])],
        ))).json()
        put_sets = put["exercises"][0]["sets"]
        deleted = await client.delete(f"/api/workouts/{put['id']}")
        assert deleted.status_code == 204

        started = (await client.post("/api/workouts", json={})).json()
        added = (await client.post(
            f"/api/workouts/{started['id']}/exercises", json={"exercise_id": squat.id}
        )).json()
        posted_sets = added["exercises"][0]["sets"]

    assert put_sets[0]["previous"] == {"weight_kg": 70, "reps": 10, "duration_s": None}
    assert put_sets[1]["max_set"] == {"weight_kg": 75, "reps": 8, "duration_s": None}
    assert [(s["previous"], s["max_set"]) for s in put_sets] == [
        (s["previous"], s["max_set"]) for s in posted_sets
    ]


# --- a save that hits a unique constraint: named, not guessed ----------------------------

class _DriverError(Exception):
    """Stands in for the driver's exception, which names the violated constraint."""

    def __init__(self, constraint_name: str) -> None:
        super().__init__(f'duplicate key value violates unique constraint "{constraint_name}"')
        self.constraint_name = constraint_name


def _integrity(constraint_name: str) -> IntegrityError:
    orig = RuntimeError("unique violation")
    orig.__cause__ = _DriverError(constraint_name)
    return IntegrityError("INSERT", {}, orig)


def _put_db():
    """Just enough session for `put_workout` when its save is replaced: no rows, no SQL."""
    return SimpleNamespace(
        scalar=AsyncMock(return_value=None), add=lambda _: None, rollback=AsyncMock(),
    )


@pytest.mark.parametrize(("constraint", "detail"), [
    ("ux_workouts_one_in_progress", "a workout is already in progress"),
    ("workouts_uuid_key", "version_conflict"),
    ("workout_exercises_uuid_key", "uuid already in use"),
    ("workout_sets_uuid_key", "uuid already in use"),
])
async def test_put_names_the_constraint_its_save_hit(monkeypatch, constraint, detail) -> None:
    db = _put_db()
    user = SimpleNamespace(id=1, role="user", permissions=GYM)
    monkeypatch.setattr(workouts, "get_visible_exercises", AsyncMock(return_value={}))
    monkeypatch.setattr(workouts, "_save", AsyncMock(side_effect=_integrity(constraint)))

    with pytest.raises(Invalid) as raised:
        await workouts.put_workout(db, user, uuid4(), WorkoutPutIn.model_validate(_body()))
    assert str(raised.value) == detail
    db.rollback.assert_awaited_once()


async def test_put_re_raises_an_unknown_constraint(monkeypatch) -> None:
    db = _put_db()
    user = SimpleNamespace(id=1, role="user", permissions=GYM)
    monkeypatch.setattr(workouts, "get_visible_exercises", AsyncMock(return_value={}))
    monkeypatch.setattr(workouts, "_save", AsyncMock(side_effect=_integrity("other_key")))

    with pytest.raises(IntegrityError):
        await workouts.put_workout(db, user, uuid4(), WorkoutPutIn.model_validate(_body()))
