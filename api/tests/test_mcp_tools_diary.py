"""Diary and goal tools over the in-memory MCP transport (needs Postgres)."""

import pytest
import sqlalchemy as sa

from app.mcp.context import set_off_client, today
from app.models.diary import DiaryEntry
from app.models.user import AuditEvent
from tests.factories import make_food, make_user
from tests.mcp_helpers import FakeOff, call, call_error, mcp_client

MON = "2026-03-02"


@pytest.fixture(autouse=True)
def _off():
    set_off_client(FakeOff())
    yield
    set_off_client(None)


async def test_add_entry_then_get_day(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db, name="Pasta", brand="Barilla")
    async with mcp_client(user, client_id="claude") as client:
        entry = await call(client, "add_diary_entry", date=MON, meal="lunch", food_id=food.id, grams=80)
        day = await call(client, "get_day", date=MON)
    assert entry["food"] == "Pasta (Barilla)"
    assert entry["kcal"] == 160.0  # 200 kcal/100 g * 80 g
    assert [e["entry_id"] for e in day["meals"]["lunch"]] == [entry["entry_id"]]
    assert day["total"] == {"kcal": 160.0, "protein_g": 16.0, "carbs_g": 8.0, "fat_g": 6.4}
    assert day["goal"] is None and day["remaining"] is None
    audit = (await db.scalars(sa.select(AuditEvent).where(AuditEvent.action == "mcp.add_diary_entry"))).all()
    assert len(audit) == 1


async def test_date_defaults_to_today(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        entry = await call(client, "add_diary_entry", meal="snack", food_id=food.id, grams=10)
    assert entry["date"] == today().isoformat()


async def test_add_entries_is_all_or_nothing(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        message = await call_error(client, "add_diary_entries", entries=[
            {"date": MON, "meal": "dinner", "food_id": food.id, "grams": 100},
            {"date": MON, "meal": "dinner", "food_id": 999_999, "grams": 50},
        ])
        ok = await call(client, "add_diary_entries", entries=[
            {"date": MON, "meal": "dinner", "food_id": food.id, "grams": 100},
            {"date": MON, "meal": "dinner", "food_id": food.id, "grams": 50},
        ])
    assert "food not found" in message
    assert len(ok["entries"]) == 2
    count = await db.scalar(sa.select(sa.func.count()).select_from(DiaryEntry).where(DiaryEntry.user_id == user.id))
    assert count == 2


async def test_rejects_non_positive_grams(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        result = await client.call_tool("add_diary_entry", {"meal": "lunch", "food_id": food.id, "grams": 0})
    assert result.is_error


async def test_update_and_delete_entry(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        entry = await call(client, "add_diary_entry", date=MON, meal="lunch", food_id=food.id, grams=80)
        moved = await call(client, "update_diary_entry", entry_id=entry["entry_id"], meal="dinner", grams=50)
        assert (moved["meal"], moved["grams"]) == ("dinner", 50.0)
        assert "Nothing to update" in await call_error(client, "update_diary_entry", entry_id=entry["entry_id"])
        assert (await call(client, "delete_diary_entry", entry_id=entry["entry_id"])) == {"deleted": True}
        day = await call(client, "get_day", date=MON)
    assert all(day["meals"][meal] == [] for meal in day["meals"])


async def test_cannot_touch_another_users_entry(db) -> None:
    alice = await make_user(db, username="alice", permissions=["mcp.access"])
    bob = await make_user(db, username="bob", permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(bob) as client:
        entry = await call(client, "add_diary_entry", date=MON, meal="lunch", food_id=food.id, grams=80)
    async with mcp_client(alice) as client:
        assert "entry not found" in await call_error(client, "delete_diary_entry", entry_id=entry["entry_id"])
        day = await call(client, "get_day", date=MON)
    assert day["meals"]["lunch"] == []


async def test_get_week_starts_on_monday(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        await call(client, "add_diary_entry", date="2026-03-04", meal="lunch", food_id=food.id, grams=100)
        week = await call(client, "get_week", date="2026-03-05")
    assert (week["start"], week["end"]) == ("2026-03-02", "2026-03-08")
    assert [d["kcal"] for d in week["days"]] == [0.0, 0.0, 200.0, 0.0, 0.0, 0.0, 0.0]


async def test_copy_days_requires_permission_then_works(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db)
    async with mcp_client(user) as client:
        await call(client, "add_diary_entry", date=MON, meal="lunch", food_id=food.id, grams=80)
        denied = await call_error(client, "copy_days", source_dates=[MON], target_start="2026-03-09")
    assert "diary.copy" in denied
    user.permissions = ["mcp.access", "diary.copy"]
    await db.flush()
    async with mcp_client(user) as client:
        copied = await call(client, "copy_days", source_dates=[MON], target_start="2026-03-09")
        day = await call(client, "get_day", date="2026-03-09")
    assert copied["entries_created"] == 1
    assert len(day["meals"]["lunch"]) == 1


async def test_goals(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        assert (await call(client, "get_goal")) == {"goal": None}
        denied = await call_error(client, "set_goal", kcal=2000, protein_g=150, carbs_g=200, fat_g=70)
    assert "goals.edit" in denied
    user.permissions = ["mcp.access", "goals.edit"]
    await db.flush()
    async with mcp_client(user) as client:
        goal = await call(client, "set_goal", kcal=2000, protein_g=150, carbs_g=200, fat_g=70)
        again = await call(client, "get_goal")
    assert goal["goal"]["kcal"] == 2000.0
    assert goal["goal"]["valid_from"] == today().isoformat()
    assert again == goal


async def test_plan_my_day_prompt(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        prompt = await client.get_prompt("plan_my_day", {"date": MON})
    text = prompt.messages[0].content.text
    assert MON in text and "get_goal" in text and "add_diary_entries" in text
