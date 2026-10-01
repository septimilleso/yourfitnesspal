from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import aiohttp
import sqlalchemy as sa
from py_vapid import Vapid
from pywebpush import WebPushException, webpush_async
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.push import PushSubscription
from app.models.user import User
from app.schemas.push import PushSubscriptionIn

if TYPE_CHECKING:
    from app.services.rest_notifier import PushSender

logger = logging.getLogger(__name__)



async def subscribe(db: AsyncSession, user: User, payload: PushSubscriptionIn) -> None:
    statement = insert(PushSubscription).values(
        user_id=user.id,
        endpoint=payload.endpoint,
        p256dh=payload.keys.p256dh,
        auth=payload.keys.auth,
    )
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=["endpoint"],
            set_={
                "user_id": user.id,
                "p256dh": payload.keys.p256dh,
                "auth": payload.keys.auth,
                "updated_at": sa.func.now(),
            },
        )
    )
    await db.commit()


async def unsubscribe(db: AsyncSession, user: User, endpoint: str) -> None:
    await db.execute(
        sa.delete(PushSubscription).where(
            PushSubscription.user_id == user.id,
            PushSubscription.endpoint == endpoint,
        )
    )
    await db.commit()


async def remove_endpoints(db: AsyncSession, endpoints: list[str]) -> None:
    if endpoints:
        await db.execute(sa.delete(PushSubscription).where(PushSubscription.endpoint.in_(endpoints)))


def make_webpush_sender(settings: Settings, http_session: aiohttp.ClientSession) -> PushSender:
    from app.services.rest_notifier import PushResult

    vapid = Vapid.from_string(settings.vapid_private_key)
    vapid.sign({"sub": settings.vapid_subject, "aud": "https://web.push.apple.com"})

    async def send(subscription_info: dict, payload: str) -> PushResult:
        try:
            await webpush_async(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=vapid,
                vapid_claims={"sub": settings.vapid_subject},
                ttl=60,
                headers={"Urgency": "high"},
                timeout=5,
                aiohttp_session=http_session,
            )
        except WebPushException as exc:
            if exc.status_code in {404, 410}:
                return PushResult.gone
            logger.exception("Web Push failed with status %s", exc.status_code)
            return PushResult.failed
        except Exception:
            logger.exception("Web Push delivery failed")
            return PushResult.failed
        return PushResult.sent

    return send
