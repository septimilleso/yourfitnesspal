import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from urllib.parse import urlsplit

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session_scope
from app.models.push import PushSubscription
from app.models.workout import Workout, WorkoutStatus
from app.services.push import remove_endpoints

logger = logging.getLogger(__name__)


class PushResult(str, Enum):
    sent = "sent"
    gone = "gone"
    failed = "failed"


PushSender = Callable[[dict, str], Awaitable[PushResult]]
MAX_LATE = timedelta(seconds=60)


@dataclass(frozen=True)
class DueRest:
    workout_id: int
    user_id: int
    name: str


async def claim_due_rests(db: AsyncSession, now: datetime) -> list[DueRest]:
    statement = (
        sa.update(Workout)
        .where(
            Workout.status == WorkoutStatus.in_progress,
            Workout.rest_ends_at <= now,
            Workout.rest_ends_at > now - MAX_LATE,
            Workout.rest_notified_at.is_distinct_from(Workout.rest_ends_at),
        )
        .values(rest_notified_at=Workout.rest_ends_at)
        .returning(Workout.id, Workout.user_id, Workout.name)
        .execution_options(synchronize_session=False)
    )
    result = await db.execute(statement)
    return [DueRest(workout_id, user_id, name) for workout_id, user_id, name in result.all()]


def rest_payload(name: str) -> str:
    title = f"Riposo finito · {name}" if name.strip() else "Riposo finito"
    return json.dumps({"title": title, "url": "/gym/workout"}, ensure_ascii=False)


async def notify_due_rests(sender: PushSender, now: datetime) -> int:
    async with session_scope() as db:
        due_rests = await claim_due_rests(db, now)
        await db.commit()
        if not due_rests:
            return 0

        user_ids = {rest.user_id for rest in due_rests}
        subscriptions = list((await db.scalars(
            sa.select(PushSubscription).where(PushSubscription.user_id.in_(user_ids))
        )).all())
        rests_by_user = {rest.user_id: rest for rest in due_rests}
        targets = [(subscription, rests_by_user[subscription.user_id])
                   for subscription in subscriptions]

        async def send_one(
            subscription: PushSubscription, rest: DueRest
        ) -> tuple[PushResult, Exception | None]:
            info = {
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            }
            try:
                return await sender(info, rest_payload(rest.name)), None
            except Exception as exc:  # noqa: BLE001
                return PushResult.failed, exc

        results = await asyncio.gather(*(
            send_one(subscription, rest) for subscription, rest in targets
        ))
        gone_endpoints = []
        for (subscription, rest), (result, error) in zip(targets, results):
            if result is PushResult.gone:
                gone_endpoints.append(subscription.endpoint)
            elif error is not None or result is PushResult.failed:
                endpoint_host = urlsplit(subscription.endpoint).hostname or subscription.endpoint[:80]
                logger.warning(
                    "Push failed for endpoint %s (workout %s, user %s)",
                    endpoint_host,
                    rest.workout_id,
                    rest.user_id,
                )

        await remove_endpoints(db, gone_endpoints)
        await db.commit()
        return len(targets)
