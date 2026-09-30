"""Claiming and notifying expired workout rests (needs Postgres)."""

import json
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

from app.models.push import PushSubscription
from app.schemas.workout import (
    FinishIn,
    RestIn,
    SetPatch,
    WorkoutExerciseAdd,
    WorkoutRename,
    WorkoutStart,
)
from app.services import workouts
from app.services.rest_notifier import PushResult, notify_due_rests, rest_payload
from tests.factories import GYM, make_exercise, make_user

T0 = datetime(2026, 9, 24, 18, 0, tzinfo=UTC)


@pytest.fixture
def clock(monkeypatch):
    """Freeze `workouts.now()`; `clock.advance(seconds)` moves it forward."""

    class Clock:
        current = T0

        def advance(self, seconds: int) -> None:
            self.current += timedelta(seconds=seconds)

    c = Clock()
    monkeypatch.setattr(workouts, "now", lambda: c.current)
    return c


async def _active_workout(db, user, *, rest_seconds: int = 90):
    exercise = await make_exercise(db, name="Zzq Notifier Squat")
    workout = await workouts.start_workout(db, user, WorkoutStart())
    workout = await workouts.add_exercise(
        db, user, workout.id, WorkoutExerciseAdd(exercise_id=exercise.id)
    )
    workout = await workouts.complete_set(
        db, user, workout.id, workout.exercises[0].sets[0].id, SetPatch(weight_kg=80, reps=8)
    )
    if rest_seconds != 90:
        workout = await workouts.rest(db, user, workout.id, RestIn(start_s=rest_seconds))
    return await workouts.rename_workout(db, user, workout.id, WorkoutRename(name="Giorno 1"))


async def _subscriptions(db, user, *endpoints: str) -> None:
    db.add_all(
        PushSubscription(user_id=user.id, endpoint=endpoint, p256dh="key", auth="auth")
        for endpoint in endpoints
    )
    await db.flush()


def _fake_sender(*, gone: set[str] | None = None):
    calls = []

    async def send(subscription: dict, payload: str) -> PushResult:
        calls.append((subscription, json.loads(payload)))
        return PushResult.gone if subscription["endpoint"] in (gone or set()) else PushResult.sent

    return send, calls


def _calls_for_endpoints(calls, *endpoints: str):
    return [call for call in calls if call[0]["endpoint"] in endpoints]


async def test_notifies_each_subscription_once(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    await _active_workout(db, user)
    endpoints = ("https://fcm.googleapis.com/a", "https://fcm.googleapis.com/b")
    await _subscriptions(db, user, *endpoints)
    sender, calls = _fake_sender()

    assert await notify_due_rests(sender, T0 + timedelta(seconds=91)) == 2
    sent = _calls_for_endpoints(calls, *endpoints)
    assert len(sent) == 2
    assert {call[1]["title"] for call in sent} == {"Riposo finito · Giorno 1"}
    assert {call[1]["url"] for call in sent} == {"/gym/workout"}
    assert await notify_due_rests(sender, T0 + timedelta(seconds=92)) == 0
    assert len(_calls_for_endpoints(calls, *endpoints)) == 2


async def test_skip_suppresses_push(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    workout = await _active_workout(db, user)
    await workouts.rest(db, user, workout.id, RestIn(skip=True))
    await _subscriptions(db, user, "https://fcm.googleapis.com/a")
    sender, calls = _fake_sender()

    assert await notify_due_rests(sender, T0 + timedelta(seconds=91)) == 0
    assert _calls_for_endpoints(calls, "https://fcm.googleapis.com/a") == []


async def test_adjusted_rest_notifies_only_at_new_end(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    workout = await _active_workout(db, user)
    await workouts.rest(db, user, workout.id, RestIn(delta_s=15))
    await _subscriptions(db, user, "https://fcm.googleapis.com/a")
    sender, calls = _fake_sender()

    assert await notify_due_rests(sender, T0 + timedelta(seconds=91)) == 0
    assert await notify_due_rests(sender, T0 + timedelta(seconds=106)) == 1
    assert await notify_due_rests(sender, T0 + timedelta(seconds=107)) == 0
    assert len(_calls_for_endpoints(calls, "https://fcm.googleapis.com/a")) == 1


async def test_finish_suppresses_push(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    workout = await _active_workout(db, user)
    await workouts.finish_workout(db, user, workout.id, FinishIn())
    await _subscriptions(db, user, "https://fcm.googleapis.com/a")
    sender, calls = _fake_sender()

    assert await notify_due_rests(sender, T0 + timedelta(seconds=91)) == 0
    assert _calls_for_endpoints(calls, "https://fcm.googleapis.com/a") == []


async def test_delete_suppresses_push(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    workout = await _active_workout(db, user)
    await workouts.delete_workout(db, user, workout.id)
    await _subscriptions(db, user, "https://fcm.googleapis.com/a")
    sender, calls = _fake_sender()

    assert await notify_due_rests(sender, T0 + timedelta(seconds=91)) == 0
    assert _calls_for_endpoints(calls, "https://fcm.googleapis.com/a") == []


async def test_skips_rest_late_by_more_than_sixty_seconds(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    await _active_workout(db, user)
    await _subscriptions(db, user, "https://fcm.googleapis.com/a")
    sender, calls = _fake_sender()

    assert await notify_due_rests(sender, T0 + timedelta(seconds=151)) == 0
    assert _calls_for_endpoints(calls, "https://fcm.googleapis.com/a") == []


async def test_gone_subscription_is_removed(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    await _active_workout(db, user)
    gone_endpoint = "https://fcm.googleapis.com/gone"
    live_endpoint = "https://fcm.googleapis.com/live"
    await _subscriptions(db, user, gone_endpoint, live_endpoint)
    sender, calls = _fake_sender(gone={gone_endpoint})

    assert await notify_due_rests(sender, T0 + timedelta(seconds=91)) == 2
    remaining = set((await db.scalars(
        sa.select(PushSubscription.endpoint).where(PushSubscription.user_id == user.id)
    )).all())
    assert remaining == {live_endpoint}
    assert len(_calls_for_endpoints(calls, gone_endpoint, live_endpoint)) == 2


def test_rest_payload_without_name() -> None:
    assert json.loads(rest_payload("")) == {"title": "Riposo finito", "url": "/gym/workout"}
    assert json.loads(rest_payload("   ")) == {"title": "Riposo finito", "url": "/gym/workout"}


async def test_sender_exception_does_not_abort_other_subscriptions(db, clock) -> None:
    user = await make_user(db, permissions=GYM)
    await _active_workout(db, user)
    endpoints = ("https://fcm.googleapis.com/fail", "https://fcm.googleapis.com/ok")
    await _subscriptions(db, user, *endpoints)
    calls = []

    async def sender(subscription: dict, payload: str) -> PushResult:
        calls.append(subscription["endpoint"])
        if subscription["endpoint"].endswith("/fail"):
            raise RuntimeError("network error")
        return PushResult.sent

    assert await notify_due_rests(sender, T0 + timedelta(seconds=91)) == 2
    assert len([endpoint for endpoint in calls if endpoint in endpoints]) == 2
    assert await notify_due_rests(sender, T0 + timedelta(seconds=92)) == 0
    assert len([endpoint for endpoint in calls if endpoint in endpoints]) == 2
