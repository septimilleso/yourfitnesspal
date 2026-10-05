"""DB-backed operations for saved diary weeks."""

from datetime import timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.diary import DiaryEntry, Meal
from app.models.saved_week import SavedWeek, SavedWeekItem
from app.models.user import User
from app.permissions import Permission, ensure_permission
from app.schemas.saved_week import (
    SavedWeekCreate,
    SavedWeekDayOut,
    SavedWeekDetail,
    SavedWeekItemOut,
    SavedWeekRename,
    SavedWeekSummary,
)
from app.services.diary import zero_totals
from app.services.errors import Invalid, NotFound
from app.services.saved_week_rules import (
    clean_name,
    ensure_monday,
    item_day_totals,
    week_stats,
)


def _summary(week: SavedWeek) -> SavedWeekSummary:
    entries_count, avg_kcal = week_stats(week.items)
    return SavedWeekSummary(
        id=week.id,
        name=week.name,
        created_at=week.created_at,
        entries_count=entries_count,
        avg_kcal=avg_kcal,
    )


def _item_out(item: SavedWeekItem) -> SavedWeekItemOut:
    return SavedWeekItemOut(
        id=item.id,
        food_id=item.food_id,
        food_name=item.food.name,
        food_brand=item.food.brand,
        grams=item.grams,
        portion_label=item.portion_label,
        position=item.position,
    )


async def own_saved_week(db: AsyncSession, user: User, saved_week_id: int) -> SavedWeek:
    week = await db.scalar(
        sa.select(SavedWeek)
        .where(SavedWeek.id == saved_week_id, SavedWeek.user_id == user.id)
        .options(selectinload(SavedWeek.items).selectinload(SavedWeekItem.food))
        .execution_options(populate_existing=True)
    )
    if week is None:
        raise NotFound("saved week not found")
    return week


async def create_saved_week(
    db: AsyncSession, user: User, payload: SavedWeekCreate
) -> SavedWeekSummary:
    ensure_permission(user, Permission.diary_copy)
    name = clean_name(payload.name)
    ensure_monday(payload.start)
    end = payload.start + timedelta(days=6)
    entries = (
        await db.scalars(
            sa.select(DiaryEntry)
            .where(
                DiaryEntry.user_id == user.id,
                DiaryEntry.date >= payload.start,
                DiaryEntry.date <= end,
            )
            .options(selectinload(DiaryEntry.food))
            .order_by(DiaryEntry.date, DiaryEntry.meal, DiaryEntry.position, DiaryEntry.id)
        )
    ).all()
    if not entries:
        raise Invalid("la settimana non ha nessun pasto")

    week = SavedWeek(
        user_id=user.id,
        name=name,
        items=[
            SavedWeekItem(
                day_index=(entry.date - payload.start).days,
                meal=entry.meal,
                food_id=entry.food_id,
                food=entry.food,
                grams=entry.grams,
                portion_label=entry.portion_label,
                position=entry.position,
            )
            for entry in entries
        ],
    )
    db.add(week)
    await db.commit()
    return _summary(await own_saved_week(db, user, week.id))


async def list_saved_weeks(db: AsyncSession, user: User) -> list[SavedWeekSummary]:
    ensure_permission(user, Permission.diary_copy)
    weeks = (
        await db.scalars(
            sa.select(SavedWeek)
            .where(SavedWeek.user_id == user.id)
            .options(selectinload(SavedWeek.items).selectinload(SavedWeekItem.food))
            .order_by(SavedWeek.created_at.desc(), SavedWeek.id.desc())
        )
    ).all()
    return [_summary(week) for week in weeks]


async def rename_saved_week(
    db: AsyncSession, user: User, saved_week_id: int, payload: SavedWeekRename
) -> SavedWeekSummary:
    ensure_permission(user, Permission.diary_copy)
    week = await own_saved_week(db, user, saved_week_id)
    week.name = clean_name(payload.name)
    await db.commit()
    return _summary(week)


async def delete_saved_week(db: AsyncSession, user: User, saved_week_id: int) -> None:
    ensure_permission(user, Permission.diary_copy)
    week = await own_saved_week(db, user, saved_week_id)
    await db.delete(week)
    await db.commit()


async def get_saved_week(db: AsyncSession, user: User, saved_week_id: int) -> SavedWeekDetail:
    ensure_permission(user, Permission.diary_copy)
    week = await own_saved_week(db, user, saved_week_id)
    totals = item_day_totals(week.items)
    by_day: dict[int, dict[str, list[SavedWeekItemOut]]] = {
        day_index: {meal.value: [] for meal in Meal} for day_index in range(7)
    }
    for item in week.items:
        by_day[item.day_index][item.meal.value].append(_item_out(item))

    return SavedWeekDetail(
        **_summary(week).model_dump(),
        days=[
            SavedWeekDayOut(
                day_index=day_index,
                meals=by_day[day_index],
                total=(totals[day_index]["total"] if day_index in totals else zero_totals()),
            )
            for day_index in range(7)
        ],
    )
