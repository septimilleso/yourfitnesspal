"""Diary/goal service functions shared by REST and MCP (needs Postgres)."""

from datetime import date

import pytest

from app.models.diary import Meal
from app.schemas.diary import DiaryCopyRequest, DiaryEntryCreate, DiaryEntryPatch, GoalCreate
from app.services import diary_ops, goals
from app.services.errors import Invalid, NotFound, PermissionMissing
from tests.factories import make_food, make_user

D = date(2026, 3, 2)


def _entry(food_id: int, grams: float = 80, meal: Meal = Meal.lunch) -> DiaryEntryCreate:
    return DiaryEntryCreate(date=D, meal=meal, food_id=food_id, grams=grams)


async def test_create_entries_assigns_increasing_positions(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    created = await diary_ops.create_entries(db, user, [_entry(food.id), _entry(food.id, 20)])
    assert [e.position for e in created] == [0, 1]
    assert created[0].food_name == "Pasta"


async def test_create_entries_is_all_or_nothing(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    with pytest.raises(NotFound, match="food not found"):
        await diary_ops.create_entries(db, user, [_entry(food.id), _entry(999_999)])
    day = await diary_ops.get_day(db, user, D)
    assert day.entries["lunch"] == []


async def test_other_users_custom_food_is_not_found(db) -> None:
    alice = await make_user(db, username="alice")
    bob = await make_user(db, username="bob")
    bobs_food = await make_food(db, name="Bob's", owner=bob)
    with pytest.raises(NotFound, match="food not found"):
        await diary_ops.create_entry(db, alice, _entry(bobs_food.id))


async def test_update_and_delete_other_users_entry_is_not_found(db) -> None:
    alice = await make_user(db, username="alice")
    bob = await make_user(db, username="bob")
    food = await make_food(db)
    entry = await diary_ops.create_entry(db, bob, _entry(food.id))
    with pytest.raises(NotFound, match="entry not found"):
        await diary_ops.update_entry(db, alice, entry.id, DiaryEntryPatch(grams=10))
    with pytest.raises(NotFound, match="entry not found"):
        await diary_ops.delete_entry(db, alice, entry.id)


async def test_update_entry_moves_meal_to_end(db) -> None:
    user = await make_user(db)
    food = await make_food(db)
    await diary_ops.create_entry(db, user, _entry(food.id, meal=Meal.dinner))
    entry = await diary_ops.create_entry(db, user, _entry(food.id))
    moved = await diary_ops.update_entry(db, user, entry.id, DiaryEntryPatch(meal=Meal.dinner, grams=5))
    assert (moved.meal, moved.position, moved.grams) == (Meal.dinner, 1, 5)


async def test_copy_days_requires_permission(db) -> None:
    user = await make_user(db, permissions=[])
    payload = DiaryCopyRequest(source_dates=[D], target_start=date(2026, 3, 9))
    with pytest.raises(PermissionMissing) as info:
        await diary_ops.copy_days(db, user, payload)
    assert info.value.permission == "diary.copy"


async def test_copy_days_rejects_empty_sources(db) -> None:
    user = await make_user(db, permissions=["diary.copy"])
    with pytest.raises(Invalid, match="source_dates must be non-empty"):
        await diary_ops.copy_days(db, user, DiaryCopyRequest(source_dates=[], target_start=D))


async def test_set_goal_requires_permission(db) -> None:
    user = await make_user(db, permissions=[])
    with pytest.raises(PermissionMissing):
        await goals.set_goal(db, user, GoalCreate(kcal=2000, protein_g=150, carbs_g=200, fat_g=70), D)


async def test_set_goal_uses_given_valid_from(db) -> None:
    user = await make_user(db, permissions=["goals.edit"])
    goal = await goals.set_goal(
        db, user, GoalCreate(kcal=2000, protein_g=150, carbs_g=200, fat_g=70), D
    )
    assert goal.valid_from == D
    assert (await goals.active_goal(db, user.id, D)).id == goal.id
    assert await goals.active_goal(db, user.id, date(2026, 3, 1)) is None
