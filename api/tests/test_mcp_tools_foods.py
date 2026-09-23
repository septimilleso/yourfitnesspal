"""Food tools over the in-memory MCP transport (needs Postgres)."""

import pytest

from app.mcp.context import set_off_client
from tests.factories import make_food, make_user
from tests.mcp_helpers import ExplodingOff, FakeOff, call, call_error, mcp_client


@pytest.fixture(autouse=True)
def _off():
    set_off_client(FakeOff())
    yield
    set_off_client(None)


async def test_tools_are_listed(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        names = {tool.name for tool in (await client.list_tools()).tools}
    assert {"search_foods", "get_food_by_barcode", "get_recent_foods", "create_custom_food"} <= names


async def test_search_returns_compact_foods(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    food = await make_food(db, name="Pasta di semola", brand="Barilla")
    set_off_client(ExplodingOff())  # no OFF permission -> never contacted
    async with mcp_client(user) as client:
        data = await call(client, "search_foods", query="semola")
    assert data["openfoodfacts_disabled"] is True
    assert data["results"] == [{
        "food_id": food.id, "name": "Pasta di semola", "brand": "Barilla",
        "serving_size_g": None,
        "per_100g": {"kcal": 200.0, "protein_g": 20.0, "carbs_g": 10.0, "fat_g": 8.0},
    }]


async def test_barcode_miss_is_a_tool_error(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        message = await call_error(client, "get_food_by_barcode", barcode="8001234567890")
    assert "food not found" in message


async def test_create_custom_food_requires_permission(db) -> None:
    user = await make_user(db, permissions=["mcp.access"])
    async with mcp_client(user) as client:
        message = await call_error(
            client, "create_custom_food", name="Torta", kcal=350, protein_g=6, carbs_g=50, fat_g=14
        )
    assert "foods.custom_create" in message


async def test_create_custom_food(db) -> None:
    user = await make_user(db, permissions=["mcp.access", "foods.custom_create"])
    async with mcp_client(user) as client:
        food = await call(
            client, "create_custom_food", name="Torta", kcal=350, protein_g=6, carbs_g=50, fat_g=14
        )
        found = await call(client, "search_foods", query="Torta")
    assert food["per_100g"] == {"kcal": 350.0, "protein_g": 6.0, "carbs_g": 50.0, "fat_g": 14.0}
    assert [f["food_id"] for f in found["results"]] == [food["food_id"]]


async def test_revoked_permission_blocks_tools(db) -> None:
    user = await make_user(db, permissions=[])
    async with mcp_client(user) as client:
        message = await call_error(client, "get_recent_foods")
    assert "revoked" in message
