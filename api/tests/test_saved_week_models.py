"""Saved-week model constraints (requires Postgres)."""

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.models.diary import Meal
from app.models.food import Food
from app.models.saved_week import SavedWeek, SavedWeekItem
from app.models.user import User
from tests.factories import make_food, make_user


async def _add_saved_week_item(db, user: User, food: Food) -> tuple[SavedWeek, SavedWeekItem]:
    week = SavedWeek(user_id=user.id, name="Dieta A")
    db.add(week)
    await db.flush()

    item = SavedWeekItem(
        saved_week_id=week.id,
        day_index=0,
        meal=Meal.breakfast,
        food_id=food.id,
        grams=100,
        portion_label=None,
        position=0,
    )
    db.add(item)
    await db.flush()
    return week, item


async def test_deleting_user_cascades_to_saved_weeks_and_items(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    week, item = await _add_saved_week_item(db, user, food)

    await db.execute(sa.delete(User).where(User.id == user.id))

    assert await db.scalar(sa.select(SavedWeek.id).where(SavedWeek.id == week.id)) is None
    assert await db.scalar(sa.select(SavedWeekItem.id).where(SavedWeekItem.id == item.id)) is None


async def test_deleting_saved_week_cascades_to_items(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    week, item = await _add_saved_week_item(db, user, food)

    await db.execute(sa.delete(SavedWeek).where(SavedWeek.id == week.id))

    assert await db.scalar(sa.select(SavedWeekItem.id).where(SavedWeekItem.id == item.id)) is None


async def test_deleting_referenced_food_raises_integrity_error(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    await _add_saved_week_item(db, user, food)

    await db.delete(food)
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_day_index_out_of_range_raises_integrity_error(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    week = SavedWeek(user_id=user.id, name="Dieta A")
    db.add(week)
    await db.flush()
    db.add(
        SavedWeekItem(
            saved_week_id=week.id,
            day_index=7,
            meal=Meal.breakfast,
            food_id=food.id,
            grams=100,
            position=0,
        )
    )

    with pytest.raises(IntegrityError):
        await db.flush()
