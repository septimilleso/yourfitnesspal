"""Tests for the foods search/barcode/custom-create endpoints.

Most of these need a live Postgres instance with the Task 3 migration
applied and the pg_trgm extension enabled (search ordering relies on
`similarity()`) -- same DATABASE_URL setup as test_models.py:

    DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/yfp_test \\
        pytest api/tests/test_foods_router.py -v

Each DB-backed test runs inside a transaction that's rolled back afterward
(via a `get_session` dependency override), so the test database is left
clean regardless of pass/fail. The 401 and validation tests don't touch the
DB at all (the auth middleware / Pydantic validation short-circuit before
any query runs) and so run standalone, without a database.
"""

from datetime import date

import httpx
import pytest
import respx
import sqlalchemy as sa
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, get_session
from app.main import app
from app.models.diary import DiaryEntry, Meal
from app.models.food import Food, FoodPortion
from app.security import create_session_cookie

BASE_URL = "https://world.openfoodfacts.org"

NUTRIMENTS = {
    "kcal": 250,
    "protein_g": 10.5,
    "carbs_g": 30.2,
    "sugars_g": 12.6,
    "fat_g": 8.1,
    "sat_fat_g": 2.4,
    "fiber_g": 3.0,
    "salt_g": 0.4,
}


def _off_product(code: str, name: str) -> dict:
    return {
        "code": code,
        "product_name": name,
        "brands": "Testco",
        "nutriments": {
            "energy-kcal_100g": 250,
            "proteins_100g": 10.5,
            "carbohydrates_100g": 30.2,
            "sugars_100g": 12.6,
            "fat_100g": 8.1,
            "saturated-fat_100g": 2.4,
            "fiber_100g": 3.0,
            "salt_100g": 0.4,
        },
    }


@pytest.fixture
async def session():
    """A session bound to a connection whose outer transaction is always
    rolled back, wired up as the app's `get_session` dependency so the
    router under test reads/writes through this same rolled-back
    transaction."""
    async with engine.connect() as connection:
        trans = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as sess:
            app.dependency_overrides[get_session] = lambda: sess
            try:
                yield sess
            finally:
                app.dependency_overrides.pop(get_session, None)
        await trans.rollback()


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="https://test")


async def _authed_client() -> AsyncClient:
    client = await _client()
    client.cookies.set("session", create_session_cookie("authenticated"))
    return client


async def _make_food(session: AsyncSession, *, name: str, brand: str = "Testco",
                      barcode: str | None = None) -> Food:
    food = Food(
        barcode=barcode,
        source="off",
        name=name,
        brand=brand,
        nutriments=NUTRIMENTS,
        raw=None,
    )
    session.add(food)
    await session.flush()
    session.add(FoodPortion(food_id=food.id, label="100 g", grams=100, is_default=True))
    return food


# --- search ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_search_returns_local_only_when_enough_local_matches(session: AsyncSession) -> None:
    for i in range(10):
        await _make_food(session, name=f"Protein Bar {i}", barcode=f"1000000000{i:03d}")
    await session.commit()

    async with respx.mock(base_url=BASE_URL) as mock:
        off_route = mock.get("/cgi/search.pl")

        client = await _authed_client()
        async with client:
            response = await client.get(
                "/api/foods/search", params={"q": "Protein Bar", "limit": 20}
            )

    assert response.status_code == 200
    assert off_route.called is False
    body = response.json()
    assert len(body["results"]) == 10
    assert all(item["source"] == "cache" for item in body["results"])


@pytest.mark.asyncio
async def test_search_with_small_limit_does_not_call_off_when_local_matches_plentiful(
    session: AsyncSession,
) -> None:
    """Regression test: with >=LOCAL_MATCH_THRESHOLD local matches available,
    a caller-supplied `limit` smaller than the threshold must not force an
    OFF fallback call -- the local query should be probed at
    max(limit, LOCAL_MATCH_THRESHOLD) before the fallback decision, then the
    merged response trimmed down to `limit`."""
    for i in range(10):
        await _make_food(session, name=f"Protein Bar {i}", barcode=f"1000000000{i:03d}")
    await session.commit()

    async with respx.mock(base_url=BASE_URL) as mock:
        off_route = mock.get("/cgi/search.pl")

        client = await _authed_client()
        async with client:
            response = await client.get(
                "/api/foods/search", params={"q": "Protein Bar", "limit": 3}
            )

    assert response.status_code == 200
    assert off_route.called is False
    body = response.json()
    assert len(body["results"]) <= 3
    assert all(item["source"] == "cache" for item in body["results"])


@pytest.mark.asyncio
async def test_search_falls_through_to_off_and_upserts_when_local_matches_sparse(
    session: AsyncSession,
) -> None:
    await _make_food(session, name="Rare Snack", barcode="9990000000001")
    await session.commit()

    products = [_off_product(f"77700000000{i}", f"Rare Snack {i}") for i in range(5)]

    async with respx.mock(base_url=BASE_URL) as mock:
        mock.get("/cgi/search.pl").mock(
            return_value=httpx.Response(200, json={"products": products})
        )
        client = await _authed_client()
        async with client:
            response = await client.get(
                "/api/foods/search", params={"q": "Rare Snack", "limit": 20}
            )

    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 6  # 1 local + 5 newly upserted from OFF
    sources = {item["source"] for item in body["results"]}
    assert sources == {"cache", "off"}

    upserted = await session.execute(
        sa.select(Food).where(Food.barcode.like("77700000000%"))
    )
    assert len(upserted.scalars().all()) == 5


@pytest.mark.asyncio
async def test_repeated_search_second_time_returns_cache_hits_only(
    session: AsyncSession,
) -> None:
    await _make_food(session, name="Common Snack", barcode="9990000000002")
    await session.commit()

    products = [_off_product(f"66600000000{i}", f"Common Snack {i}") for i in range(9)]

    async with respx.mock(base_url=BASE_URL) as mock:
        off_route = mock.get("/cgi/search.pl").mock(
            return_value=httpx.Response(200, json={"products": products})
        )
        client = await _authed_client()
        async with client:
            first = await client.get(
                "/api/foods/search", params={"q": "Common Snack", "limit": 20}
            )
            assert first.status_code == 200
            assert off_route.call_count == 1
            assert len(first.json()["results"]) == 10  # 1 local + 9 upserted -> now >= threshold

            second = await client.get(
                "/api/foods/search", params={"q": "Common Snack", "limit": 20}
            )

    assert second.status_code == 200
    assert off_route.call_count == 1  # not called again -- local matches now suffice
    body = second.json()
    assert len(body["results"]) == 10
    assert all(item["source"] == "cache" for item in body["results"])


# --- barcode -----------------------------------------------------------


@pytest.mark.asyncio
async def test_barcode_hit_returns_cached_food(session: AsyncSession) -> None:
    await _make_food(session, name="Barcode Food", barcode="1234567890123")
    await session.commit()

    client = await _authed_client()
    async with client:
        response = await client.get("/api/foods/barcode/1234567890123")

    assert response.status_code == 200
    body = response.json()
    assert body["barcode"] == "1234567890123"
    assert body["source"] == "off"
    assert body["name"] == "Barcode Food"


@pytest.mark.asyncio
async def test_barcode_miss_returns_404(session: AsyncSession) -> None:
    async with respx.mock(base_url=BASE_URL) as mock:
        mock.get("/api/v2/product/0000000000000.json").mock(
            return_value=httpx.Response(404, json={"status": 0})
        )
        client = await _authed_client()
        async with client:
            response = await client.get("/api/foods/barcode/0000000000000")

    assert response.status_code == 404


# --- recent ------------------------------------------------------------


@pytest.mark.asyncio
async def test_recent_foods_orders_by_most_recently_logged(session: AsyncSession) -> None:
    """"Recent" ranks by the food's most recently-logged diary entry, newest
    first -- not by the food's own creation order. `food_a` is logged first
    but `food_b` is logged later (and more recently), so `food_b` must sort
    first even though it was created after `food_a`."""
    food_a = await _make_food(session, name="Food A", barcode="1112223330001")
    food_c = await _make_food(session, name="Food C (never logged)", barcode="1112223330003")
    food_b = await _make_food(session, name="Food B", barcode="1112223330002")
    await session.flush()

    session.add(
        DiaryEntry(
            food_id=food_a.id,
            date=date(2026, 8, 1),
            meal=Meal.breakfast,
            grams=100,
            position=0,
            nutriments_snapshot=NUTRIMENTS,
        )
    )
    session.add(
        DiaryEntry(
            food_id=food_b.id,
            date=date(2026, 8, 2),
            meal=Meal.lunch,
            grams=50,
            position=0,
            nutriments_snapshot=NUTRIMENTS,
        )
    )
    await session.commit()

    client = await _authed_client()
    async with client:
        response = await client.get("/api/foods/recent")

    assert response.status_code == 200
    body = response.json()
    names = [item["name"] for item in body["results"]]
    # Only logged foods appear, most-recently-logged first.
    assert names == ["Food B", "Food A"]
    assert food_c.name not in names
    assert all(item["source"] == "cache" for item in body["results"])


@pytest.mark.asyncio
async def test_recent_foods_respects_limit(session: AsyncSession) -> None:
    for i in range(5):
        food = await _make_food(session, name=f"Logged {i}", barcode=f"222333000{i:04d}")
        await session.flush()
        session.add(
            DiaryEntry(
                food_id=food.id,
                date=date(2026, 8, 1 + i),
                meal=Meal.snack,
                grams=10,
                position=0,
                nutriments_snapshot=NUTRIMENTS,
            )
        )
    await session.commit()

    client = await _authed_client()
    async with client:
        response = await client.get("/api/foods/recent", params={"limit": 2})

    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 2
    assert [item["name"] for item in body["results"]] == ["Logged 4", "Logged 3"]


# --- custom food creation -----------------------------------------------


@pytest.mark.asyncio
async def test_create_custom_food_requires_all_nutriment_fields() -> None:
    """No `session` fixture -- validation fails before the DB is touched."""
    client = await _authed_client()
    async with client:
        response = await client.post(
            "/api/foods",
            json={"name": "Homemade Soup", "nutriments": {"kcal": 120}},
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_create_custom_food_succeeds_with_full_payload(session: AsyncSession) -> None:
    client = await _authed_client()
    async with client:
        response = await client.post(
            "/api/foods",
            json={"name": "Homemade Soup", "nutriments": NUTRIMENTS},
        )

    assert response.status_code == 201
    body = response.json()
    assert body["source"] == "custom"
    assert body["name"] == "Homemade Soup"
    assert body["nutriments"] == NUTRIMENTS


# --- auth --------------------------------------------------------------


@pytest.mark.asyncio
async def test_foods_endpoints_401_without_session_cookie() -> None:
    """No `session` fixture -- the auth middleware short-circuits before
    the DB is ever touched."""
    async with await _client() as client:
        search_response = await client.get("/api/foods/search", params={"q": "x"})
        barcode_response = await client.get("/api/foods/barcode/1234567890123")
        recent_response = await client.get("/api/foods/recent")
        create_response = await client.post(
            "/api/foods", json={"name": "X", "nutriments": NUTRIMENTS}
        )

    assert search_response.status_code == 401
    assert barcode_response.status_code == 401
    assert recent_response.status_code == 401
    assert create_response.status_code == 401
