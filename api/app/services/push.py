import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.push import PushSubscription
from app.models.user import User
from app.schemas.push import PushSubscriptionIn


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
