"""Stats API: app-open activity and the days-in-a-row streak."""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.stats import GymCountOut, GymStatsOut, StreakOut
from app.services import activity, gym_stats

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats/gym/count", response_model=GymCountOut)
async def read_gym_count(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> GymCountOut:
    return await gym_stats.count_finished(session, user)


@router.get("/stats/gym", response_model=GymStatsOut)
async def read_gym_stats(
    start: date = Query(...),
    end: date = Query(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> GymStatsOut:
    return await gym_stats.period_stats(session, user, start, end)


@router.post("/activity", status_code=204)
async def post_activity(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await activity.record_activity(session, user, activity.local_today())


@router.get("/stats/streak", response_model=StreakOut)
async def read_streak(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> StreakOut:
    streak = await activity.get_streak(session, user, activity.local_today())
    return StreakOut(current=streak.current, best=streak.best)
