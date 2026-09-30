"""Constraints on push subscription and rest notification models (needs Postgres)."""

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.models.push import PushSubscription
from app.models.workout import Workout, WorkoutStatus
from tests.factories import make_user


async def test_push_subscription_endpoint_is_unique(db) -> None:
    user = await make_user(db)
    db.add(PushSubscription(
        user_id=user.id, endpoint="https://web.push.apple.com/test",
        p256dh="public-key", auth="auth-secret",
    ))
    await db.flush()
    db.add(PushSubscription(
        user_id=user.id, endpoint="https://web.push.apple.com/test",
        p256dh="other-key", auth="other-secret",
    ))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_deleting_user_cascades_to_push_subscriptions(db) -> None:
    user = await make_user(db)
    subscription = PushSubscription(
        user_id=user.id, endpoint="https://web.push.apple.com/test",
        p256dh="public-key", auth="auth-secret",
    )
    db.add(subscription)
    await db.flush()

    await db.delete(user)
    await db.flush()

    assert await db.scalar(
        sa.select(PushSubscription.id).where(PushSubscription.id == subscription.id)
    ) is None


async def test_new_workout_has_no_notified_rest(db) -> None:
    user = await make_user(db)
    workout = Workout(
        user_id=user.id,
        name="Test workout",
        status=WorkoutStatus.in_progress,
        started_at=datetime.now(UTC),
    )
    db.add(workout)
    await db.flush()

    assert workout.rest_notified_at is None
