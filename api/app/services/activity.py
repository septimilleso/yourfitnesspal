"""App-open activity days and the "days in a row" streak."""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.activity import UserActivityDay
from app.models.user import User


@dataclass(frozen=True)
class Streak:
    current: int
    best: int


def local_today() -> date:
    return datetime.now(ZoneInfo(settings.app_timezone)).date()


def compute_streak(days: Iterable[date], today: date) -> Streak:
    """`current` is the run ending today, or yesterday when today is not
    recorded yet; `best` is the longest run ever. Days after `today` are
    ignored."""
    ordered = sorted({day for day in days if day <= today})
    best = 0
    run = 0
    previous: date | None = None
    for day in ordered:
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best = max(best, run)
        previous = day
    current = run if previous is not None and today - previous <= timedelta(days=1) else 0
    return Streak(current=current, best=best)


async def record_activity(db: AsyncSession, user: User, day: date) -> None:
    await db.execute(
        insert(UserActivityDay)
        .values(user_id=user.id, day=day)
        .on_conflict_do_nothing(index_elements=["user_id", "day"])
    )
    await db.commit()


async def get_streak(db: AsyncSession, user: User, today: date) -> Streak:
    days = await db.scalars(
        sa.select(UserActivityDay.day).where(UserActivityDay.user_id == user.id)
    )
    return compute_streak(days.all(), today)
