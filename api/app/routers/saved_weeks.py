"""Saved diary week endpoints. Domain logic lives in app/services/saved_weeks.py."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require_permission
from app.db import get_session
from app.models.user import User
from app.permissions import Permission
from app.schemas.saved_week import SavedWeekCreate, SavedWeekDetail, SavedWeekSummary
from app.services import saved_weeks

router = APIRouter(prefix="/api/saved-weeks", tags=["saved-weeks"])


@router.post("", response_model=SavedWeekSummary, status_code=201)
async def create(
    payload: SavedWeekCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.diary_copy)),
) -> SavedWeekSummary:
    return await saved_weeks.create_saved_week(session, user, payload)


@router.get("", response_model=list[SavedWeekSummary])
async def list_all(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.diary_copy)),
) -> list[SavedWeekSummary]:
    return await saved_weeks.list_saved_weeks(session, user)


@router.get("/{saved_week_id}", response_model=SavedWeekDetail)
async def get_one(
    saved_week_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(require_permission(Permission.diary_copy)),
) -> SavedWeekDetail:
    return await saved_weeks.get_saved_week(session, user, saved_week_id)
