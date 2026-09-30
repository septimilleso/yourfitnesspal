from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.config import settings
from app.db import get_session
from app.models.user import User
from app.schemas.push import PushConfigOut, PushSubscriptionIn, PushUnsubscribeIn
from app.services import push

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/config", response_model=PushConfigOut)
async def config() -> PushConfigOut:
    return PushConfigOut(public_key=settings.vapid_public_key if settings.push_enabled else None)


@router.post("/subscriptions", status_code=204)
async def subscribe(
    payload: PushSubscriptionIn,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    await push.subscribe(db, user, payload)
    return Response(status_code=204)


@router.post("/unsubscribe", status_code=204)
async def unsubscribe(
    payload: PushUnsubscribeIn,
    db: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    await push.unsubscribe(db, user, payload.endpoint)
    return Response(status_code=204)
