from datetime import date, timedelta
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.weight import BodyWeight
from app.schemas.weight import (
    WeightDayOut,
    WeightHistoryOut,
    WeightOut,
    WeightWeekOut,
)
from app.services import activity
from app.services.errors import NotFound
from app.services.stats_rules import (
    check_period,
    moving_average_7d,
    parse_weight,
    weekly_weight_averages,
)


def _weight_out(row: BodyWeight) -> WeightOut:
    return WeightOut(id=row.id, date=row.date, weight_kg=float(row.weight_kg))


async def log_today(db: AsyncSession, user: User, value: object) -> WeightOut:
    weight = parse_weight(value)
    day = activity.local_today()
    result = await db.execute(
        insert(BodyWeight)
        .values(user_id=user.id, date=day, weight_kg=weight)
        .on_conflict_do_update(
            constraint="uq_body_weights_user_date",
            set_={"weight_kg": weight},
        )
        .returning(BodyWeight.id, BodyWeight.date, BodyWeight.weight_kg)
    )
    row = result.one()
    await db.commit()
    return WeightOut(id=row.id, date=row.date, weight_kg=float(row.weight_kg))


async def get_today(db: AsyncSession, user: User) -> WeightOut | None:
    row = await db.scalar(
        sa.select(BodyWeight).where(
            BodyWeight.user_id == user.id,
            BodyWeight.date == activity.local_today(),
        )
    )
    return _weight_out(row) if row is not None else None


async def delete_weight(db: AsyncSession, user: User, weight_id: int) -> None:
    row = await db.scalar(
        sa.select(BodyWeight).where(
            BodyWeight.id == weight_id,
            BodyWeight.user_id == user.id,
        )
    )
    if row is None:
        raise NotFound("weight not found")
    await db.delete(row)
    await db.commit()


async def weight_history(
    db: AsyncSession, user: User, start: date, end: date
) -> WeightHistoryOut:
    check_period(start, end)
    first_week = start - timedelta(days=start.weekday())
    last_week_end = end + timedelta(days=6 - end.weekday())
    query_start = min(start - timedelta(days=6), first_week - timedelta(days=7))
    rows = (
        await db.scalars(
            sa.select(BodyWeight)
            .where(
                BodyWeight.user_id == user.id,
                BodyWeight.date >= query_start,
                BodyWeight.date <= last_week_end,
            )
            .order_by(BodyWeight.date)
        )
    ).all()
    weights = {row.date: Decimal(row.weight_kg) for row in rows}
    rows_by_date = {row.date: row for row in rows}
    days = [
        WeightDayOut(
            date=day,
            id=rows_by_date[day].id if day in rows_by_date else None,
            weight_kg=float(weights[day]) if day in weights else None,
            avg_7d_kg=moving_average_7d(weights, day),
        )
        for day in (start + timedelta(days=offset) for offset in range((end - start).days + 1))
    ]
    weeks = [
        WeightWeekOut(
            week_start=week.week_start,
            avg_kg=week.avg_kg,
            count=week.count,
            change_kg=week.change_kg,
        )
        for week in weekly_weight_averages(weights, start, end)
    ]
    return WeightHistoryOut(start=start, end=end, days=days, weeks=weeks)
