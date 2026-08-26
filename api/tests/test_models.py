"""Model round-trip tests against a real Postgres database.

These tests use the app's own session factory (`app.db.AsyncSessionLocal`,
built from `DATABASE_URL` in `app.config.settings`) so they exercise the
actual JSONB / Postgres-enum / FK behavior the app relies on. They need a
live Postgres instance with the Task 3 migration applied
(`alembic upgrade head`) -- point `DATABASE_URL` at a disposable test
database before running them, e.g.:

    DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/yfp_test \\
        pytest api/tests/test_models.py -v

Each test runs inside a transaction that is rolled back at the end, so the
test database is left clean regardless of pass/fail.
"""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine
from app.models import DiaryEntry, Food, FoodPortion, Meal

NUTRIMENTS = {
    "calories": 250,
    "protein_g": 10.5,
    "carbs_g": 30.2,
    "fat_g": 8.1,
    "saturated_fat_g": 2.4,
    "fiber_g": 3.0,
    "sugar_g": 12.6,
    "sodium_mg": 400,
}


@pytest.fixture
async def session():
    """A session bound to a connection whose outer transaction is always
    rolled back, so tests never leave rows behind in the test database."""
    async with engine.connect() as connection:
        trans = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as sess:
            yield sess
        await trans.rollback()


@pytest.mark.asyncio
async def test_food_and_portion_round_trip(session: AsyncSession) -> None:
    food = Food(
        barcode="0000000000017",
        name="Test Bar",
        brand="Testco",
        nutriments=NUTRIMENTS,
        raw={"code": "0000000000017", "product_name": "Test Bar"},
    )
    session.add(food)
    await session.flush()

    portion = FoodPortion(food_id=food.id, name="1 bar", grams=45)
    session.add(portion)
    await session.commit()

    fetched = await session.scalar(select(Food).where(Food.id == food.id))
    assert fetched is not None
    assert fetched.barcode == "0000000000017"
    assert set(fetched.nutriments.keys()) == set(NUTRIMENTS.keys())
    assert len(fetched.nutriments) == 8
    for key, value in NUTRIMENTS.items():
        assert fetched.nutriments[key] == value

    fetched_portion = await session.scalar(
        select(FoodPortion).where(FoodPortion.food_id == food.id)
    )
    assert fetched_portion is not None
    assert fetched_portion.name == "1 bar"
    assert float(fetched_portion.grams) == 45.0


@pytest.mark.asyncio
async def test_diary_entry_references_food_and_snapshots_nutriments(
    session: AsyncSession,
) -> None:
    food = Food(
        barcode="0000000000024",
        name="Test Yogurt",
        brand="Testco",
        nutriments=NUTRIMENTS,
        raw=None,
    )
    session.add(food)
    await session.flush()

    entry = DiaryEntry(
        food_id=food.id,
        date="2026-08-26",
        meal=Meal.breakfast,
        quantity=1,
        nutriments_snapshot=NUTRIMENTS,
    )
    session.add(entry)
    await session.commit()

    fetched = await session.scalar(select(DiaryEntry).where(DiaryEntry.id == entry.id))
    assert fetched is not None
    assert fetched.food_id == food.id
    assert fetched.meal == Meal.breakfast
    assert str(fetched.date) == "2026-08-26"

    assert set(fetched.nutriments_snapshot.keys()) == set(NUTRIMENTS.keys())
    assert len(fetched.nutriments_snapshot) == 8
    for key, value in NUTRIMENTS.items():
        assert fetched.nutriments_snapshot[key] == value
