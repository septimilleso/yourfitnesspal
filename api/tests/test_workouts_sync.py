"""`PUT /api/workouts/{uuid}`: create and replace a whole workout (needs Postgres, except the schema checks)."""

import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app import main
from app.models.exercise import Tracking
from app.models.workout import Workout, WorkoutExercise, WorkoutSet, WorkoutStatus
from app.schemas.workout import TemplateIn, WorkoutOut, WorkoutPutIn, WorkoutPutSet
from app.services import templates, workouts
from app.services.errors import Conflict, Invalid, NotFound
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
        refresh=AsyncMock(),
    )


class _OrmUser:
    """The request's user as an ORM object. A rollback expires it, and reading an expired
    attribute fails here, as it would need I/O (MissingGreenlet) under AsyncSession."""

    def __init__(self) -> None:
        self._values = {"id": 1, "role": "user", "permissions": GYM}
        self.expired = False

    def _read(self, name: str):
        if self.expired:
            raise AssertionError(f"user.{name} read while expired")
        return self._values[name]

    @property
    def id(self) -> int:
        return self._read("id")

    @property
    def role(self) -> str:
        return self._read("role")

    @property
    def permissions(self) -> list[str]:
        return self._read("permissions")

    def expire(self) -> None:
        self.expired = True

    def refresh(self) -> None:
        self.expired = False


def _race_session(user: _OrmUser, scalars: list) -> SimpleNamespace:
    """A session whose rollback expires `user` and whose refresh makes it readable again."""
    db = _put_db()
    db.scalar = AsyncMock(side_effect=scalars)
    db.rollback = AsyncMock(side_effect=user.expire)
    db.refresh = AsyncMock(side_effect=lambda _: user.refresh())
    return db


def _stored(**overrides) -> Workout:
    """A stored workout holding the content `_body()` sends, as a transient row (no session)."""
    fields = {
        "id": 7, "uuid": uuid4(), "user_id": 1, "version": 5, "name": "Giorno 1",
        "template_id": None, "status": WorkoutStatus.in_progress, "started_at": T0,
        "finished_at": None, "rest_ends_at": None, "rest_total_s": None,
    }
    fields.update(overrides)
    return Workout(**fields)


USER = SimpleNamespace(id=1, role="user", permissions=GYM)
COPY = object()  # stands in for the stored `WorkoutOut` a 409 carries


def _fake_put(monkeypatch, *, stored=None, other=None):
    """`put_workout` without a database: the lookups and the save are replaced."""
    db = _put_db()
    monkeypatch.setattr(workouts, "get_visible_exercises", AsyncMock(return_value={}))
    monkeypatch.setattr(workouts, "_stored_by_uuid", AsyncMock(return_value=stored))
    monkeypatch.setattr(workouts, "_other_active", AsyncMock(return_value=other))
    monkeypatch.setattr(workouts, "workout_out", AsyncMock(return_value=COPY))
    save = AsyncMock(return_value=COPY)
    monkeypatch.setattr(workouts, "_save", save)
    return db, save


# --- C6: conflicts answer 409 with the stored copy ----------------------------------------

async def test_put_conflicts_answer_409_with_the_stored_copy(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Put Conflict")
    workout_uuid = uuid4()
    url = f"/api/workouts/{workout_uuid}"
    async with await http_client(db, user) as client:
        created = await client.put(url, json=_body(name="Giorno 1"))
        assert created.status_code == 201
        # four saves with other content take the workout to version 5
        for version in range(1, 5):
            saved = await client.put(url, json=_body(
                base_version=version, name=f"Giorno {version + 1}",
                exercises=[_item(squat.id, [_set(80, 8)])],
            ))
            assert saved.status_code == 200
        assert saved.json()["version"] == 5

        # a stale version with other content: the copy of the server comes back
        stale = await client.put(url, json=_body(base_version=4, name="Altro"))
        assert stale.status_code == 409
        assert stale.json()["detail"] == "version_conflict"
        assert stale.json()["current"]["version"] == 5
        assert stale.json()["current"]["name"] == "Giorno 5"

        # an uuid that no longer exists, with a version: 409 and no copy
        gone = await client.put(f"/api/workouts/{uuid4()}", json=_body(base_version=2))
        assert gone.status_code == 409
        assert gone.json() == {"detail": "version_conflict", "current": None}

        # a second workout in progress: the active one comes back, nothing is written
        second = await client.put(f"/api/workouts/{uuid4()}", json=_body(name="Seconda"))
        assert second.status_code == 409
        assert second.json()["detail"] == "other_active"
        assert second.json()["current"]["uuid"] == str(workout_uuid)

    stored = await db.scalar(sa.select(Workout.version).where(Workout.uuid == workout_uuid))
    assert stored == 5


# --- C7: another user's uuid is not found -------------------------------------------------

async def test_put_of_another_users_uuid_is_404(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    other = await make_user(db, username="bob", permissions=GYM)
    theirs = await make_finished_workout(
        db, other, started_at=T0 - timedelta(days=1), minutes=30, items=[],
    )
    async with await http_client(db, user) as client:
        with_version = await client.put(f"/api/workouts/{theirs.uuid}", json=_body(base_version=1))
        without = await client.put(f"/api/workouts/{theirs.uuid}", json=_body())
    assert with_version.status_code == 404
    assert without.status_code == 404


# --- C8: the same body sent again is idempotent -------------------------------------------

async def test_put_resent_with_the_same_content_is_200_and_keeps_the_version(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    squat = await make_exercise(db, name="Zzq Put Resend")
    workout_uuid = uuid4()
    url = f"/api/workouts/{workout_uuid}"
    body = _body(base_version=1, name="Giorno 2", exercises=[_item(squat.id, [_set(80, 8)])])
    async with await http_client(db, user) as client:
        assert (await client.put(url, json=_body(name="Giorno 1"))).status_code == 201
        first = await client.put(url, json=body)
        assert (first.status_code, first.json()["version"]) == (200, 2)

        again = await client.put(url, json=body)
    assert (again.status_code, again.json()["version"]) == (200, 2)
    assert again.json()["id"] == first.json()["id"]


# --- R4 and R5 DELETE: `base_version` decides between 204 and 409 -------------------------

async def test_delete_with_base_version_checks_the_stored_version(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    workout_uuid = uuid4()
    url = f"/api/workouts/{workout_uuid}"
    async with await http_client(db, user) as client:
        created = (await client.put(url, json=_body(name="Giorno 1"))).json()
        assert (await client.put(url, json=_body(base_version=1, name="Giorno 2"))).status_code == 200
        workout_id = created["id"]

        stale = await client.delete(f"/api/workouts/{workout_id}?base_version=1")
        assert stale.status_code == 409
        assert stale.json()["detail"] == "version_conflict"
        assert stale.json()["current"]["version"] == 2
        assert (await client.get(f"/api/workouts/{workout_id}")).status_code == 200

        right = await client.delete(f"/api/workouts/{workout_id}?base_version=2")
        assert right.status_code == 204

        # without the parameter the delete is unconditional, as before
        fresh = (await client.put(f"/api/workouts/{uuid4()}", json=_body(name="Giorno 3"))).json()
        plain = await client.delete(f"/api/workouts/{fresh['id']}")
        assert plain.status_code == 204


async def test_conflict_body_is_the_reason_and_the_stored_copy() -> None:
    """The 409 body the TS client reads: `detail` is the reason, `current` the workout or null."""
    copy = WorkoutOut(
        id=7, uuid=uuid4(), version=5, name="Giorno 1", template_id=None,
        status=WorkoutStatus.in_progress, started_at=T0, finished_at=None,
        rest_ends_at=None, rest_total_s=None, server_now=T0, exercises=[],
    )
    with_copy = await main._conflict(None, Conflict("version_conflict", copy))
    assert with_copy.status_code == 409
    body = json.loads(with_copy.body)
    assert body["detail"] == "version_conflict"
    assert body["current"]["version"] == 5
    assert body["current"]["started_at"] == "2026-09-24T18:00:00Z"

    without_copy = await main._conflict(None, Conflict("version_conflict", None))
    assert json.loads(without_copy.body) == {"detail": "version_conflict", "current": None}


# --- R4 and R5 without a database: the checks run before any write ----------------------

async def test_put_with_the_stored_content_is_200_and_writes_nothing(monkeypatch) -> None:
    db, save = _fake_put(monkeypatch, stored=_stored(version=5))
    # a stale base_version does not matter when the content is the stored one (R5)
    saved, created = await workouts.put_workout(
        db, USER, uuid4(), WorkoutPutIn.model_validate(_body(base_version=1))
    )
    assert (saved, created) == (COPY, False)
    save.assert_not_awaited()


async def test_put_with_a_stale_version_is_a_409_with_the_stored_copy(monkeypatch) -> None:
    db, save = _fake_put(monkeypatch, stored=_stored(version=5))
    with pytest.raises(Conflict) as raised:
        await workouts.put_workout(
            db, USER, uuid4(), WorkoutPutIn.model_validate(_body(base_version=4, name="Altro"))
        )
    assert (raised.value.reason, raised.value.current) == ("version_conflict", COPY)
    save.assert_not_awaited()


async def test_put_over_a_finished_workout_with_other_content_is_a_conflict(monkeypatch) -> None:
    stored = _stored(
        version=5, status=WorkoutStatus.finished, finished_at=T0 + timedelta(minutes=1),
    )
    db, save = _fake_put(monkeypatch, stored=stored)
    with pytest.raises(Conflict) as raised:
        # the version matches, but the server already finished it with other content
        await workouts.put_workout(
            db, USER, stored.uuid, WorkoutPutIn.model_validate(_body(base_version=5, name="Altro"))
        )
    assert (raised.value.reason, raised.value.current) == ("version_conflict", COPY)
    save.assert_not_awaited()


async def test_put_of_a_vanished_uuid_with_a_base_version_is_a_409_without_copy(
    monkeypatch,
) -> None:
    db, save = _fake_put(monkeypatch, stored=None)
    with pytest.raises(Conflict) as raised:
        await workouts.put_workout(db, USER, uuid4(), WorkoutPutIn.model_validate(_body(base_version=2)))
    assert (raised.value.reason, raised.value.current) == ("version_conflict", None)
    save.assert_not_awaited()


async def test_put_of_a_second_in_progress_workout_is_other_active(monkeypatch) -> None:
    db, save = _fake_put(monkeypatch, stored=None, other=COPY)
    with pytest.raises(Conflict) as raised:
        await workouts.put_workout(db, USER, uuid4(), WorkoutPutIn.model_validate(_body()))
    assert (raised.value.reason, raised.value.current) == ("other_active", COPY)
    save.assert_not_awaited()


# --- a save that hits a unique constraint: named, not guessed ----------------------------

async def test_put_maps_a_race_on_the_one_in_progress_index_to_other_active(
    monkeypatch, clock,
) -> None:
    user = _OrmUser()
    # the lookups, in order: the uuid before the save, the check before the save, then after
    # the rollback the other active id and its row (read by `load_workout`)
    db = _race_session(user, [None, None, 9, _stored(id=9, uuid=uuid4())])
    monkeypatch.setattr(workouts, "get_visible_exercises", AsyncMock(return_value={}))
    monkeypatch.setattr(workouts, "workout_out", AsyncMock(return_value=COPY))
    monkeypatch.setattr(workouts, "_save", AsyncMock(side_effect=_integrity("ux_workouts_one_in_progress")))

    with pytest.raises(Conflict) as raised:
        await workouts.put_workout(db, user, uuid4(), WorkoutPutIn.model_validate(_body()))
    assert (raised.value.reason, raised.value.current) == ("other_active", COPY)
    db.rollback.assert_awaited_once()
    db.refresh.assert_awaited_once_with(user)


async def test_put_maps_a_creation_race_to_version_conflict_with_the_stored_copy(
    monkeypatch, clock,
) -> None:
    user = _OrmUser()
    # the other creation of this uuid has other content, so the client merges with it
    db = _race_session(user, [None, None, 7, _stored(name="Altro")])
    monkeypatch.setattr(workouts, "get_visible_exercises", AsyncMock(return_value={}))
    monkeypatch.setattr(workouts, "workout_out", AsyncMock(return_value=COPY))
    monkeypatch.setattr(workouts, "_save", AsyncMock(side_effect=_integrity("workouts_uuid_key")))

    with pytest.raises(Conflict) as raised:
        await workouts.put_workout(db, user, uuid4(), WorkoutPutIn.model_validate(_body()))
    assert (raised.value.reason, raised.value.current) == ("version_conflict", COPY)
    db.rollback.assert_awaited_once()
    db.refresh.assert_awaited_once_with(user)


async def test_put_racing_an_identical_creation_is_200_without_a_conflict(
    monkeypatch, clock,
) -> None:
    user = _OrmUser()
    # the other creation of this uuid has the same content: two identical PUTs, one answer (R5)
    db = _race_session(user, [None, None, 7, _stored()])
    monkeypatch.setattr(workouts, "get_visible_exercises", AsyncMock(return_value={}))
    monkeypatch.setattr(workouts, "workout_out", AsyncMock(return_value=COPY))
    monkeypatch.setattr(workouts, "_save", AsyncMock(side_effect=_integrity("workouts_uuid_key")))

    saved, created = await workouts.put_workout(
        db, user, uuid4(), WorkoutPutIn.model_validate(_body())
    )
    assert (saved, created) == (COPY, False)
    db.refresh.assert_awaited_once_with(user)


async def test_put_resent_with_a_clamped_time_is_200_without_a_new_version(
    monkeypatch, clock,
) -> None:
    # a set done before the workout started is stored clamped to `started_at` (R6)
    stored = _stored(exercises=[WorkoutExercise(
        exercise_id=1, rest_seconds=90, superset_group=None, note=None, position=0,
        sets=[WorkoutSet(position=0, weight_kg=80, reps=8, duration_s=None, completed_at=T0)],
    )])
    db, save = _fake_put(monkeypatch, stored=stored)
    monkeypatch.setattr(workouts, "get_visible_exercises", AsyncMock(
        return_value={1: SimpleNamespace(tracking=Tracking.weight_reps)},
    ))
    early = _set(80, 8)
    early["completed_at"] = (T0 - timedelta(days=1)).isoformat()

    saved, created = await workouts.put_workout(
        db, USER, uuid4(), WorkoutPutIn.model_validate(_body(exercises=[_item(1, [early])])),
    )
    assert (saved, created) == (COPY, False)
    save.assert_not_awaited()


# --- _stored_by_uuid: a row that vanished, and another user's row ------------------------

async def test_stored_by_uuid_is_none_when_the_row_vanished_between_the_reads(monkeypatch) -> None:
    db = SimpleNamespace(scalar=AsyncMock(side_effect=[7, None]))
    monkeypatch.setattr(
        workouts, "load_workout", AsyncMock(side_effect=NotFound("workout not found")),
    )
    assert await workouts._stored_by_uuid(db, USER, uuid4()) is None


async def test_stored_by_uuid_is_not_found_for_another_users_row(monkeypatch) -> None:
    db = SimpleNamespace(scalar=AsyncMock(side_effect=[7, 7]))
    monkeypatch.setattr(
        workouts, "load_workout", AsyncMock(side_effect=NotFound("workout not found")),
    )
    with pytest.raises(NotFound):
        await workouts._stored_by_uuid(db, USER, uuid4())


@pytest.mark.parametrize("constraint", ["workout_exercises_uuid_key", "workout_sets_uuid_key"])
async def test_put_maps_a_repeated_item_uuid_to_invalid(monkeypatch, constraint) -> None:
    db, save = _fake_put(monkeypatch)
    save.side_effect = _integrity(constraint)

    with pytest.raises(Invalid) as raised:
        await workouts.put_workout(db, USER, uuid4(), WorkoutPutIn.model_validate(_body()))
    assert str(raised.value) == "uuid already in use"
    db.rollback.assert_awaited_once()


async def test_put_reads_the_constraint_from_the_message_without_a_driver_name(monkeypatch) -> None:
    db, save = _fake_put(monkeypatch)
    # no `constraint_name` on the driver error: the message text is the fallback
    save.side_effect = IntegrityError(
        "INSERT", {}, RuntimeError('duplicate key value violates unique constraint "workout_sets_uuid_key"'),
    )

    with pytest.raises(Invalid) as raised:
        await workouts.put_workout(db, USER, uuid4(), WorkoutPutIn.model_validate(_body()))
    assert str(raised.value) == "uuid already in use"


async def test_put_re_raises_an_unknown_constraint(monkeypatch) -> None:
    db = _put_db()
    user = SimpleNamespace(id=1, role="user", permissions=GYM)
    monkeypatch.setattr(workouts, "get_visible_exercises", AsyncMock(return_value={}))
    monkeypatch.setattr(workouts, "_save", AsyncMock(side_effect=_integrity("other_key")))

    with pytest.raises(IntegrityError):
        await workouts.put_workout(db, user, uuid4(), WorkoutPutIn.model_validate(_body()))


# --- delete with base_version, without a database ----------------------------------------

@pytest.mark.parametrize(("base_version", "deleted"), [(4, False), (5, True), (None, True)])
async def test_delete_checks_base_version_before_deleting(monkeypatch, base_version, deleted) -> None:
    stored = _stored(version=5)
    load = AsyncMock(return_value=stored)
    monkeypatch.setattr(workouts, "load_workout", load)
    monkeypatch.setattr(workouts, "workout_out", AsyncMock(return_value=COPY))
    db = SimpleNamespace(delete=AsyncMock(), commit=AsyncMock())

    if deleted:
        await workouts.delete_workout(db, USER, 7, base_version)
        db.delete.assert_awaited_once_with(stored)
        db.commit.assert_awaited_once()
    else:
        with pytest.raises(Conflict) as raised:
            await workouts.delete_workout(db, USER, 7, base_version)
        assert (raised.value.reason, raised.value.current) == ("version_conflict", COPY)
        db.delete.assert_not_awaited()
    load.assert_awaited_once_with(db, USER, 7, for_update=True)
