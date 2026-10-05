from datetime import UTC, date, datetime
from decimal import Decimal

import sqlalchemy as sa

from app.config import settings
from app.models.weight import BodyWeight
from app.services import activity, weights
from tests.factories import http_client, make_user


async def test_put_today_upserts_and_validates_weight(db, monkeypatch) -> None:
    today = date(2026, 10, 2)
    monkeypatch.setattr(weights.activity, "local_today", lambda: today)
    user = await make_user(db)
    async with await http_client(db, user) as client:
        first = await client.put("/api/weights/today", json={"weight_kg": 78.0})
        second = await client.put("/api/weights/today", json={"weight_kg": 78.46})
        assert first.status_code == second.status_code == 200
        assert second.json()["weight_kg"] == 78.5
        assert (await client.get("/api/weights/today")).json() == {
            "id": second.json()["id"], "date": "2026-10-02", "weight_kg": 78.5
        }
        for value in (19.9, 400.1, "abc"):
            response = await client.put("/api/weights/today", json={"weight_kg": value})
            assert response.status_code == 400
    rows = (
        await db.scalars(sa.select(BodyWeight).where(BodyWeight.user_id == user.id))
    ).all()
    assert len(rows) == 1
    assert rows[0].date == today
    assert rows[0].weight_kg == Decimal("78.5")


async def test_put_today_requires_weight_value_with_bad_request(db, monkeypatch) -> None:
    monkeypatch.setattr(weights.activity, "local_today", lambda: date(2026, 10, 2))
    user = await make_user(db)
    async with await http_client(db, user) as client:
        response = await client.put("/api/weights/today", json={})
    assert response.status_code == 400


async def test_put_today_accepts_weight_boundaries_and_comma_decimal(db, monkeypatch) -> None:
    monkeypatch.setattr(weights.activity, "local_today", lambda: date(2026, 10, 2))
    user = await make_user(db)
    async with await http_client(db, user) as client:
        for value, expected in ((20.0, 20.0), (400.0, 400.0), ("78,4", 78.4)):
            response = await client.put("/api/weights/today", json={"weight_kg": value})
            assert response.status_code == 200
            assert response.json()["weight_kg"] == expected


async def test_put_today_uses_configured_local_timezone(db, monkeypatch) -> None:
    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            utc_now = cls(2026, 10, 1, 23, 30, tzinfo=UTC)
            return utc_now.astimezone(tz) if tz is not None else utc_now

    monkeypatch.setattr(activity, "datetime", FixedDateTime)
    monkeypatch.setattr(settings, "app_timezone", "Europe/Rome")
    user = await make_user(db)
    async with await http_client(db, user) as client:
        response = await client.put("/api/weights/today", json={"weight_kg": 78.4})
    assert response.status_code == 200
    assert response.json()["date"] == "2026-10-02"


async def test_weight_history_daily_and_weekly_averages(db) -> None:
    user = await make_user(db)
    db.add_all([
        BodyWeight(user_id=user.id, date=date(2026, 10, 1), weight_kg=70.0),
        BodyWeight(user_id=user.id, date=date(2026, 10, 3), weight_kg=72.0),
        BodyWeight(user_id=user.id, date=date(2026, 10, 8), weight_kg=74.0),
    ])
    await db.flush()
    async with await http_client(db, user) as client:
        response = await client.get(
            "/api/weights", params={"start": "2026-10-07", "end": "2026-10-10"}
        )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["days"]) == 4
    assert payload["days"] == [
        {"date": "2026-10-07", "id": None, "weight_kg": None, "avg_7d_kg": 71.0},
        {"date": "2026-10-08", "id": payload["days"][1]["id"], "weight_kg": 74.0, "avg_7d_kg": 73.0},
        # The 7-day window includes Oct 3 (72.0) and Oct 8 (74.0).
        {"date": "2026-10-09", "id": None, "weight_kg": None, "avg_7d_kg": 73.0},
        {"date": "2026-10-10", "id": None, "weight_kg": None, "avg_7d_kg": 74.0},
    ]
    assert payload["weeks"] == [
        {"week_start": "2026-10-05", "avg_kg": 74.0, "count": 1, "change_kg": 3.0}
    ]


async def test_weight_history_weekly_change_is_none_without_previous_week(db) -> None:
    user = await make_user(db)
    db.add(BodyWeight(user_id=user.id, date=date(2026, 10, 8), weight_kg=74.0))
    await db.flush()
    async with await http_client(db, user) as client:
        response = await client.get(
            "/api/weights", params={"start": "2026-10-07", "end": "2026-10-10"}
        )
    assert response.status_code == 200
    assert response.json()["weeks"] == [
        {"week_start": "2026-10-05", "avg_kg": 74.0, "count": 1, "change_kg": None}
    ]


async def test_delete_weight_is_scoped_to_user(db) -> None:
    alice = await make_user(db)
    bob = await make_user(db, username="bob")
    own_weight = BodyWeight(user_id=alice.id, date=date(2026, 10, 1), weight_kg=78.0)
    bobs_weight = BodyWeight(user_id=bob.id, date=date(2026, 10, 1), weight_kg=99.0)
    db.add_all([own_weight, bobs_weight])
    await db.flush()
    async with await http_client(db, alice) as client:
        assert (await client.delete(f"/api/weights/{own_weight.id}")).status_code == 204
        assert (await client.delete(f"/api/weights/{bobs_weight.id}")).status_code == 404
    assert await db.scalar(
        sa.select(sa.func.count()).select_from(BodyWeight).where(BodyWeight.id == own_weight.id)
    ) == 0
    assert await db.get(BodyWeight, bobs_weight.id) is not None


async def test_weight_history_and_authentication_are_user_scoped(db, monkeypatch) -> None:
    monkeypatch.setattr(weights.activity, "local_today", lambda: date(2026, 10, 8))
    alice = await make_user(db)
    bob = await make_user(db, username="bob")
    db.add_all([
        BodyWeight(user_id=alice.id, date=date(2026, 10, 8), weight_kg=78.0),
        BodyWeight(user_id=bob.id, date=date(2026, 10, 8), weight_kg=99.0),
    ])
    await db.flush()
    async with await http_client(db, alice) as client:
        response = await client.get(
            "/api/weights", params={"start": "2026-10-08", "end": "2026-10-08"}
        )
        assert response.status_code == 200
        history = response.json()
        assert history["days"] == [{
            "date": "2026-10-08",
            "id": history["days"][0]["id"],
            "weight_kg": 78.0,
            "avg_7d_kg": 78.0,
        }]
        assert history["weeks"] == [{
            "week_start": "2026-10-05",
            "avg_kg": 78.0,
            "count": 1,
            "change_kg": None,
        }]
        assert "99.0" not in str(history)
        today = await client.get("/api/weights/today")
        assert today.status_code == 200
        assert today.json() == {
            "id": history["days"][0]["id"],
            "date": "2026-10-08",
            "weight_kg": 78.0,
        }
        assert "99.0" not in today.text
    async with await http_client() as client:
        assert (await client.get("/api/weights/today")).status_code == 401
        assert (await client.get(
            "/api/weights", params={"start": "2026-10-08", "end": "2026-10-08"}
        )).status_code == 401
        assert (await client.put("/api/weights/today", json={"weight_kg": 78.0})).status_code == 401


async def test_weight_endpoint_rejects_bad_period_and_csrf(db) -> None:
    user = await make_user(db)
    async with await http_client(db, user) as client:
        inverted = await client.get(
            "/api/weights", params={"start": "2026-10-10", "end": "2026-10-07"}
        )
        too_long = await client.get(
            "/api/weights", params={"start": "2025-10-01", "end": "2026-10-02"}
        )
        max_length = await client.get(
            "/api/weights", params={"start": "2025-10-02", "end": "2026-10-02"}
        )
        assert inverted.status_code == 400
        assert too_long.status_code == 400
        assert max_length.status_code == 200
        assert len(max_length.json()["days"]) == 366
    async with await http_client(db, user, csrf=False) as client:
        assert (await client.put("/api/weights/today", json={"weight_kg": 78.0})).status_code == 403


async def test_get_today_returns_no_content_when_unlogged(db, monkeypatch) -> None:
    monkeypatch.setattr(weights.activity, "local_today", lambda: date(2026, 10, 2))
    user = await make_user(db)
    async with await http_client(db, user) as client:
        response = await client.get("/api/weights/today")
    assert response.status_code == 204
