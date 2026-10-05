from datetime import date

import pytest

from app.models.user import Role
from tests.factories import http_client, make_food, make_user


@pytest.mark.asyncio
async def test_copy_days_requires_diary_copy_permission(db) -> None:
    user = await make_user(db, role=Role.user, permissions=[])
    async with await http_client(db, user) as client:
        response = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-07-06"],
                "target_start": "2026-07-13",
                "mode": "append",
            },
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "forbidden"}


@pytest.mark.asyncio
async def test_copy_days_append_assigns_next_position(db) -> None:
    user = await make_user(db, permissions=["diary.copy"])
    source_food = await make_food(db, name="Source food")
    existing_food = await make_food(db, name="Existing food")

    async with await http_client(db, user) as client:
        source = await client.post(
            "/api/diary/entries",
            json={
                "date": "2026-07-06",
                "meal": "breakfast",
                "food_id": source_food.id,
                "grams": 100,
            },
        )
        assert source.status_code == 201

        existing = await client.post(
            "/api/diary/entries",
            json={
                "date": "2026-07-13",
                "meal": "breakfast",
                "food_id": existing_food.id,
                "grams": 50,
            },
        )
        assert existing.status_code == 201

        copied = await client.post(
            "/api/diary/copy",
            json={
                "source_dates": ["2026-07-06"],
                "target_start": "2026-07-13",
                "mode": "append",
            },
        )
        assert copied.status_code == 200

        target_day = await client.get(f"/api/diary/day/{date(2026, 7, 13).isoformat()}")

    entries = target_day.json()["entries"]["breakfast"]
    assert [entry["food_name"] for entry in entries] == ["Existing food", "Source food"]
    assert [entry["position"] for entry in entries] == [0, 1]
