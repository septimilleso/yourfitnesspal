"""Tests for `POST /api/diary/copy` -- the bulk day-copy endpoint.

These need a live Postgres instance with the Task 3 migration applied --
same DATABASE_URL setup as test_diary_router.py:

    DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/yfp_test \\
        pytest api/tests/test_diary_copy.py -v

Each DB-backed test runs inside a transaction that's rolled back afterward
(via a `get_session` dependency override), same pattern as
test_diary_router.py. The 401 and empty-`source_dates` tests don't touch the
DB (auth short-circuits / validation happens before any query runs).

The pure copy-*planning* logic (`plan_copy`, in `app/services/diary.py`) --
sorting source dates, mapping onto consecutive target dates, and the
overlapping source/target replace-mode ordering -- is covered without a
database in `test_diary_copy_service.py`; that's deliberately a separate,
DB-free module so it can run (and pass) even where this file cannot connect.
"""

from datetime import date

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, get_session
from app.main import app
from app.models.food import Food
from app.security import create_session_cookie

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

CHANGED_NUTRIMENTS = {
    "kcal": 999.0,
    "protein_g": 1.0,
    "carbs_g": 1.0,
    "sugars_g": 1.0,
    "fat_g": 1.0,
    "sat_fat_g": 1.0,
    "fiber_g": 1.0,
    "salt_g": 1.0,
}


@pytest.fixture
async def session():
    """A session bound to a connection whose outer transaction is always
    rolled back, wired up as the app's `get_session` dependency -- same
    pattern as test_diary_router.py."""
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


async def _make_food(session: AsyncSession, *, name: str = "Test Food") -> Food:
    food = Food(source="custom", name=name, brand=None, nutriments=NUTRIMENTS, raw=None)
    session.add(food)
    await session.flush()
    return food


async def _create_entry(
    client: AsyncClient, *, for_date: date, meal: str, food_id: int, grams: float
) -> dict:
    response = await client.post(
        "/api/diary/entries",
        json={"date": for_date.isoformat(), "meal": meal, "food_id": food_id, "grams": grams},
    )
    assert response.status_code == 201
    return response.json()


@pytest.mark.asyncio
async def test_copy_one_day_to_one_day_append(session: AsyncSession) -> None:
    food = await _make_food(session, name="Copied Food")
    await session.commit()

    client = await _authed_client()
    async with client:
        await _create_entry(
            client, for_date=date(2026, 7, 6), meal="breakfast", food_id=food.id, grams=100
        )

        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-07-06"],
                "target_start": "2026-07-13",
                "mode": "append",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["entries_created"] == 1
        assert body["days"] == [{"date": "2026-07-13", "entries_created": 1}]

        target_day = await client.get("/api/diary/day/2026-07-13")
    assert len(target_day.json()["entries"]["breakfast"]) == 1
    # A copied entry still resolves food_name via its (unchanged) food_id.
    assert target_day.json()["entries"]["breakfast"][0]["food_name"] == "Copied Food"


@pytest.mark.asyncio
async def test_copy_two_days_to_two_consecutive_days(session: AsyncSession) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client()
    async with client:
        await _create_entry(
            client, for_date=date(2026, 7, 6), meal="breakfast", food_id=food.id, grams=100
        )
        await _create_entry(
            client, for_date=date(2026, 7, 7), meal="dinner", food_id=food.id, grams=100
        )

        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-07-06", "2026-07-07"],
                "target_start": "2026-07-13",
                "mode": "append",
            },
        )
        assert response.status_code == 200
        assert response.json()["entries_created"] == 2

        mon_target = await client.get("/api/diary/day/2026-07-13")
        tue_target = await client.get("/api/diary/day/2026-07-14")
    assert len(mon_target.json()["entries"]["breakfast"]) == 1
    assert len(tue_target.json()["entries"]["dinner"]) == 1


@pytest.mark.asyncio
async def test_copy_with_meals_filter_only_touches_breakfast(session: AsyncSession) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client()
    async with client:
        await _create_entry(
            client, for_date=date(2026, 7, 6), meal="breakfast", food_id=food.id, grams=100
        )
        await _create_entry(
            client, for_date=date(2026, 7, 6), meal="lunch", food_id=food.id, grams=100
        )

        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-07-06"],
                "target_start": "2026-07-13",
                "meals": ["breakfast"],
                "mode": "append",
            },
        )
        assert response.status_code == 200
        assert response.json()["entries_created"] == 1

        target_day = await client.get("/api/diary/day/2026-07-13")
    body = target_day.json()
    assert len(body["entries"]["breakfast"]) == 1
    assert len(body["entries"]["lunch"]) == 0


@pytest.mark.asyncio
async def test_copy_replace_mode_clears_prior_target_entries_first(
    session: AsyncSession,
) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client()
    async with client:
        await _create_entry(
            client, for_date=date(2026, 7, 6), meal="breakfast", food_id=food.id, grams=100
        )
        # Pre-existing entry on the target day that should be wiped.
        stale = await _create_entry(
            client, for_date=date(2026, 7, 13), meal="breakfast", food_id=food.id, grams=999
        )

        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-07-06"],
                "target_start": "2026-07-13",
                "mode": "replace",
            },
        )
        assert response.status_code == 200

        target_day = await client.get("/api/diary/day/2026-07-13")
    entries = target_day.json()["entries"]["breakfast"]
    assert len(entries) == 1
    assert entries[0]["id"] != stale["id"]
    assert entries[0]["grams"] == 100


@pytest.mark.asyncio
async def test_copy_empty_source_day_creates_nothing_no_error(session: AsyncSession) -> None:
    client = await _authed_client()
    async with client:
        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-08-03"],  # no entries logged on this date
                "target_start": "2026-08-10",
                "mode": "append",
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["entries_created"] == 0
    assert body["days"] == [{"date": "2026-08-10", "entries_created": 0}]


@pytest.mark.asyncio
async def test_copy_overlapping_source_and_target_replace_mode_not_corrupted(
    session: AsyncSession,
) -> None:
    """source=[mon, tue], target_start=tue, mode=replace -- tue is both a
    source date and a target date. Expected final state: tue holds a copy
    of mon's original entry, wed holds a copy of tue's *original* entry
    (captured before tue got wiped), per the brief's "reads before writes"
    requirement."""
    food = await _make_food(session)
    await session.commit()

    mon = date(2026, 9, 7)
    tue = date(2026, 9, 8)
    wed = date(2026, 9, 9)

    client = await _authed_client()
    async with client:
        await _create_entry(client, for_date=mon, meal="breakfast", food_id=food.id, grams=111)
        await _create_entry(client, for_date=tue, meal="lunch", food_id=food.id, grams=222)

        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": [mon.isoformat(), tue.isoformat()],
                "target_start": tue.isoformat(),
                "mode": "replace",
            },
        )
        assert response.status_code == 200
        assert response.json()["entries_created"] == 2

        tue_result = await client.get(f"/api/diary/day/{tue.isoformat()}")
        wed_result = await client.get(f"/api/diary/day/{wed.isoformat()}")

    # tue now holds mon's entry (copied into breakfast), not its own
    # original lunch entry (that got replaced).
    tue_body = tue_result.json()
    assert len(tue_body["entries"]["breakfast"]) == 1
    assert tue_body["entries"]["breakfast"][0]["grams"] == 111
    assert len(tue_body["entries"]["lunch"]) == 0

    # wed holds a copy of tue's *original* lunch entry, not lost.
    wed_body = wed_result.json()
    assert len(wed_body["entries"]["lunch"]) == 1
    assert wed_body["entries"]["lunch"][0]["grams"] == 222


@pytest.mark.asyncio
async def test_copy_snapshot_preserved_verbatim_even_after_food_nutriments_change(
    session: AsyncSession,
) -> None:
    food = await _make_food(session)
    await session.commit()

    client = await _authed_client()
    async with client:
        created = await _create_entry(
            client, for_date=date(2026, 10, 5), meal="snack", food_id=food.id, grams=50
        )
        assert created["nutriments_snapshot"] == NUTRIMENTS

        # Underlying Food.nutriments changes after the entry was logged.
        food.nutriments = CHANGED_NUTRIMENTS
        session.add(food)
        await session.commit()

        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-10-05"],
                "target_start": "2026-10-12",
                "mode": "append",
            },
        )
        assert response.status_code == 200

        target_day = await client.get("/api/diary/day/2026-10-12")

    copied_entry = target_day.json()["entries"]["snack"][0]
    # Byte-for-byte identical to the ORIGINAL snapshot, not re-derived from
    # the food's now-different current nutriments.
    assert copied_entry["nutriments_snapshot"] == NUTRIMENTS
    assert copied_entry["nutriments_snapshot"] != CHANGED_NUTRIMENTS


@pytest.mark.asyncio
async def test_copy_empty_source_dates_returns_400() -> None:
    """No DB needed -- validated before any query runs."""
    client = await _authed_client()
    async with client:
        response = await client.post(
            "/api/diary/copy",
            json={"source_dates": [], "target_start": "2026-01-01", "mode": "append"},
        )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_copy_endpoint_401_without_session_cookie() -> None:
    async with await _client() as client:
        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-01-01"],
                "target_start": "2026-01-08",
                "mode": "append",
            },
        )
    assert response.status_code == 401
