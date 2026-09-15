"""Tests for the diary entries CRUD + day/week totals + goals endpoints.

These need a live Postgres instance with the Task 3 migration applied --
same DATABASE_URL setup as test_models.py / test_foods_router.py:

    DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/yfp_test \\
        pytest api/tests/test_diary_router.py -v

Each DB-backed test runs inside a transaction that's rolled back afterward
(via a `get_session` dependency override), so the test database is left
clean regardless of pass/fail. The 401 test doesn't touch the DB at all
(the auth middleware short-circuits before any query runs) and so runs
standalone, without a database.
"""

from datetime import UTC, date, datetime, timedelta
from typing import ClassVar

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password
from app.auth.sessions import create_session
from app.db import engine, get_session
from app.main import app
from app.models.food import Food
from app.models.user import Role, User

NUTRIMENTS = {
    "kcal": 200.0,
    "protein_g": 20.0,
    "carbs_g": 10.0,
    "sugars_g": 5.0,
    "fat_g": 8.0,
    "sat_fat_g": 2.0,
    "fiber_g": 1.0,
    "salt_g": 0.5,
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
    # X-Requested-With satisfies the CSRF middleware, which gates every
    # mutating /api/* request ahead of auth.
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="https://test", headers={"X-Requested-With": "yfp"})


class _FakeRequest:
    headers: ClassVar[dict] = {}
    client = None


async def _authed_client(db: AsyncSession) -> AsyncClient:
    client = await _client()
    user = User(username="tester", display_name="Tester", role=Role.admin,
                password_hash=hash_password("correct horse battery staple"), must_change_password=False)
    db.add(user)
    await db.flush()
    token = await create_session(db, user, _FakeRequest())
    client.cookies.set("session", token)
    return client


async def _make_food(
    session: AsyncSession, *, name: str = "Test Food", brand: str | None = None
) -> Food:
    food = Food(source="custom", name=name, brand=brand, nutriments=NUTRIMENTS, raw=None)
    session.add(food)
    await session.flush()
    return food


# --- POST /api/diary/entries -------------------------------------------


@pytest.mark.asyncio
async def test_create_entry_snapshots_full_unscaled_nutriments(session: AsyncSession) -> None:
    food = await _make_food(session, name="Yogurt Greco", brand="Fage")
    await session.commit()

    client = await _authed_client(session)
    async with client:
        response = await client.post(
            "/api/diary/entries",
            json={"date": "2026-01-01", "meal": "breakfast", "food_id": food.id, "grams": 50},
        )

    assert response.status_code == 201
    body = response.json()
    assert body["grams"] == 50
    # Snapshot is the FULL per-100g dict, unscaled -- not pre-multiplied by grams/100.
    assert body["nutriments_snapshot"] == NUTRIMENTS
    assert body["position"] == 0
    # The response carries the food's name/brand, joined from the related
    # Food row -- not just its bare `food_id`.
    assert body["food_name"] == "Yogurt Greco"
    assert body["food_brand"] == "Fage"


@pytest.mark.asyncio
async def test_create_entry_food_brand_is_null_when_food_has_no_brand(
    session: AsyncSession,
) -> None:
    food = await _make_food(session, name="Homemade Soup", brand=None)
    await session.commit()

    client = await _authed_client(session)
    async with client:
        response = await client.post(
            "/api/diary/entries",
            json={"date": "2026-01-01", "meal": "lunch", "food_id": food.id, "grams": 200},
        )

    assert response.status_code == 201
    body = response.json()
    assert body["food_name"] == "Homemade Soup"
    assert body["food_brand"] is None


@pytest.mark.asyncio
async def test_create_entry_assigns_incrementing_position_within_date_meal(
    session: AsyncSession,
) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client(session)
    async with client:
        first = await client.post(
            "/api/diary/entries",
            json={"date": "2026-01-01", "meal": "lunch", "food_id": food.id, "grams": 100},
        )
        second = await client.post(
            "/api/diary/entries",
            json={"date": "2026-01-01", "meal": "lunch", "food_id": food.id, "grams": 100},
        )
        other_meal = await client.post(
            "/api/diary/entries",
            json={"date": "2026-01-01", "meal": "dinner", "food_id": food.id, "grams": 100},
        )

    assert first.json()["position"] == 0
    assert second.json()["position"] == 1
    assert other_meal.json()["position"] == 0  # separate date+meal group


@pytest.mark.asyncio
async def test_create_entry_404_for_unknown_food(session: AsyncSession) -> None:
    client = await _authed_client(session)
    async with client:
        response = await client.post(
            "/api/diary/entries",
            json={"date": "2026-01-01", "meal": "snack", "food_id": 999999, "grams": 50},
        )
    assert response.status_code == 404


# --- GET /api/diary/day/{date} ------------------------------------------


@pytest.mark.asyncio
async def test_get_day_sums_totals_across_meals(session: AsyncSession) -> None:
    food = await _make_food(session, name="Chicken Breast", brand="Acme")
    await session.commit()

    client = await _authed_client(session)
    async with client:
        await client.post(
            "/api/diary/entries",
            json={"date": "2026-02-01", "meal": "breakfast", "food_id": food.id, "grams": 100},
        )
        await client.post(
            "/api/diary/entries",
            json={"date": "2026-02-01", "meal": "lunch", "food_id": food.id, "grams": 50},
        )

        response = await client.get("/api/diary/day/2026-02-01")

    assert response.status_code == 200
    body = response.json()
    assert body["totals"]["by_meal"]["breakfast"]["kcal"] == 200.0
    assert body["totals"]["by_meal"]["lunch"]["kcal"] == 100.0
    assert body["totals"]["total"]["kcal"] == 300.0
    assert len(body["entries"]["breakfast"]) == 1
    assert len(body["entries"]["dinner"]) == 0
    # GET /day joins food_name/food_brand onto each entry.
    assert body["entries"]["breakfast"][0]["food_name"] == "Chicken Breast"
    assert body["entries"]["breakfast"][0]["food_brand"] == "Acme"


@pytest.mark.asyncio
async def test_patch_grams_changes_totals_on_next_get(session: AsyncSession) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client(session)
    async with client:
        created = await client.post(
            "/api/diary/entries",
            json={"date": "2026-02-02", "meal": "snack", "food_id": food.id, "grams": 100},
        )
        entry_id = created.json()["id"]

        before = await client.get("/api/diary/day/2026-02-02")
        assert before.json()["totals"]["total"]["kcal"] == 200.0

        patched = await client.patch(f"/api/diary/entries/{entry_id}", json={"grams": 300})
        assert patched.status_code == 200
        # Snapshot stays fixed -- only the scaling factor (grams) changes.
        assert patched.json()["nutriments_snapshot"] == NUTRIMENTS
        # PATCH's response also carries food_name/food_brand.
        assert patched.json()["food_name"] == "Test Food"

        after = await client.get("/api/diary/day/2026-02-02")
        assert after.json()["totals"]["total"]["kcal"] == 600.0


@pytest.mark.asyncio
async def test_patch_meal_change_recomputes_position_in_new_meal_group(
    session: AsyncSession,
) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client(session)
    async with client:
        first = await client.post(
            "/api/diary/entries",
            json={"date": "2026-02-04", "meal": "breakfast", "food_id": food.id, "grams": 100},
        )
        second = await client.post(
            "/api/diary/entries",
            json={"date": "2026-02-04", "meal": "breakfast", "food_id": food.id, "grams": 100},
        )
        assert first.json()["position"] == 0
        assert second.json()["position"] == 1
        entry_id = second.json()["id"]

        patched = await client.patch(
            f"/api/diary/entries/{entry_id}", json={"meal": "lunch"}
        )

    assert patched.status_code == 200
    body = patched.json()
    # Moving to a meal with no existing entries appends at the start of
    # that (date, meal) group -- same rule POST uses for a fresh entry.
    assert body["meal"] == "lunch"
    assert body["position"] == 0


@pytest.mark.asyncio
async def test_delete_entry_removes_it_and_adjusts_totals(session: AsyncSession) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client(session)
    async with client:
        created = await client.post(
            "/api/diary/entries",
            json={"date": "2026-02-03", "meal": "dinner", "food_id": food.id, "grams": 100},
        )
        entry_id = created.json()["id"]

        deleted = await client.delete(f"/api/diary/entries/{entry_id}")
        assert deleted.status_code == 204

        after = await client.get("/api/diary/day/2026-02-03")

    assert after.json()["totals"]["total"]["kcal"] == 0.0
    assert after.json()["entries"]["dinner"] == []


# --- GET /api/diary/week --------------------------------------------------


@pytest.mark.asyncio
async def test_get_week_returns_seven_consecutive_days(session: AsyncSession) -> None:
    client = await _authed_client(session)
    async with client:
        response = await client.get("/api/diary/week", params={"start": "2026-03-02"})

    assert response.status_code == 200
    body = response.json()
    assert body["start"] == "2026-03-02"
    assert body["end"] == "2026-03-08"
    assert len(body["days"]) == 7
    expected_dates = [
        (date(2026, 3, 2) + timedelta(days=i)).isoformat() for i in range(7)
    ]
    assert [day["date"] for day in body["days"]] == expected_dates


@pytest.mark.asyncio
async def test_get_week_sums_totals_per_day_meal_less(session: AsyncSession) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client(session)
    async with client:
        await client.post(
            "/api/diary/entries",
            json={"date": "2026-03-03", "meal": "breakfast", "food_id": food.id, "grams": 100},
        )
        await client.post(
            "/api/diary/entries",
            json={"date": "2026-03-03", "meal": "dinner", "food_id": food.id, "grams": 100},
        )

        response = await client.get("/api/diary/week", params={"start": "2026-03-02"})

    body = response.json()
    day = next(d for d in body["days"] if d["date"] == "2026-03-03")
    assert day["total"]["kcal"] == 400.0
    assert "by_meal" not in day  # meal-less summary


# --- goals -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_goal_creates_new_historized_row(session: AsyncSession) -> None:
    client = await _authed_client(session)
    async with client:
        response = await client.put(
            "/api/goals",
            json={"kcal": 2000, "protein_g": 150, "carbs_g": 200, "fat_g": 60},
        )

    assert response.status_code == 201
    body = response.json()
    assert body["kcal"] == 2000
    assert body["valid_from"] == datetime.now(UTC).date().isoformat()


@pytest.mark.asyncio
async def test_day_before_second_goal_reports_first_goal(session: AsyncSession) -> None:
    from app.models.goal import Goal

    session.add(
        Goal(kcal=1800, protein_g=120, carbs_g=180, fat_g=50, valid_from=date(2026, 1, 1))
    )
    session.add(
        Goal(kcal=2200, protein_g=160, carbs_g=220, fat_g=70, valid_from=date(2026, 6, 1))
    )
    await session.commit()

    client = await _authed_client(session)
    async with client:
        before_second = await client.get("/api/diary/day/2026-03-15")
        on_and_after_second = await client.get("/api/diary/day/2026-06-01")

    assert before_second.json()["goal"]["kcal"] == 1800
    assert on_and_after_second.json()["goal"]["kcal"] == 2200


@pytest.mark.asyncio
async def test_two_goals_same_valid_from_break_tie_by_higher_id(session: AsyncSession) -> None:
    """`put_goal` always stamps `valid_from = today`, so setting a goal
    twice on the same day creates two rows with an identical `valid_from`.
    `_active_goal` must deterministically pick the most-recently-created
    (higher `id`) row, not whatever order the DB happens to return."""
    from app.models.goal import Goal

    today = date(2026, 6, 1)
    first = Goal(kcal=1800, protein_g=120, carbs_g=180, fat_g=50, valid_from=today)
    session.add(first)
    await session.flush()
    second = Goal(kcal=2200, protein_g=160, carbs_g=220, fat_g=70, valid_from=today)
    session.add(second)
    await session.flush()
    assert second.id > first.id
    await session.commit()

    client = await _authed_client(session)
    async with client:
        response = await client.get("/api/goals", params={"date": today.isoformat()})

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == second.id
    assert body["kcal"] == 2200


# --- auth --------------------------------------------------------------


@pytest.mark.asyncio
async def test_diary_endpoints_401_without_session_cookie() -> None:
    """No `session` fixture -- the auth middleware short-circuits before
    the DB is ever touched."""
    async with await _client() as client:
        day_response = await client.get("/api/diary/day/2026-01-01")
        week_response = await client.get("/api/diary/week", params={"start": "2026-01-01"})
        create_response = await client.post(
            "/api/diary/entries",
            json={"date": "2026-01-01", "meal": "snack", "food_id": 1, "grams": 10},
        )
        goal_response = await client.get("/api/goals")

    assert day_response.status_code == 401
    assert week_response.status_code == 401
    assert create_response.status_code == 401
    assert goal_response.status_code == 401
