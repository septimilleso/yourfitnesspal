"""Food service functions shared by REST and MCP (needs Postgres)."""

import pytest
from app.schemas.food import CustomFoodCreate, Nutriments
from app.services import foods
from app.services.errors import NotFound, PermissionMissing

from tests.factories import NUTRIMENTS, make_food, make_user


class ExplodingOff:
    """Fails the test if OpenFoodFacts is contacted."""

    async def search(self, q: str, limit: int):
        raise AssertionError("OFF must not be called")


class DownOff:
    async def search(self, q: str, limit: int):
        return None


async def test_search_without_off_permission_is_cache_only(db) -> None:
    user = await make_user(db, permissions=[])
    await make_food(db, name="Pasta integrale")
    result = await foods.search_foods(db, ExplodingOff(), user, "pasta", 10)
    assert result.off_disabled is True
    assert [item.name for item in result.results] == ["Pasta integrale"]


async def test_search_reports_off_outage(db) -> None:
    user = await make_user(db, permissions=["foods.off_lookup"])
    result = await foods.search_foods(db, DownOff(), user, "zzzz-nothing", 10)
    assert result.off_unavailable is True
    assert result.results == []


async def test_search_hides_other_users_custom_foods(db) -> None:
    alice = await make_user(db, username="alice")
    bob = await make_user(db, username="bob")
    await make_food(db, name="Torta di Bob", owner=bob)
    result = await foods.search_foods(db, ExplodingOff(), alice, "torta", 10)
    assert result.results == []


async def test_barcode_without_permission_is_cache_only(db) -> None:
    user = await make_user(db, permissions=[])
    with pytest.raises(NotFound, match="food not found"):
        await foods.get_by_barcode(db, ExplodingOff(), user, "8001234567890")


async def test_create_custom_food_requires_permission(db) -> None:
    user = await make_user(db, permissions=[])
    payload = CustomFoodCreate(name="Mio piatto", nutriments=Nutriments(**NUTRIMENTS))
    with pytest.raises(PermissionMissing):
        await foods.create_custom_food(db, user, payload)


async def test_create_custom_food_is_owned_by_user(db) -> None:
    user = await make_user(db, permissions=["foods.custom_create"])
    payload = CustomFoodCreate(name="Mio piatto", nutriments=Nutriments(**NUTRIMENTS))
    food = await foods.create_custom_food(db, user, payload)
    assert (food.source, food.owner_user_id, food.name) == ("custom", user.id, "Mio piatto")
