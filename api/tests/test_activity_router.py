"""Activity ping and streak endpoints (needs Postgres)."""

from datetime import date, timedelta

import sqlalchemy as sa

from app.models.activity import UserActivityDay
from app.services import activity
from tests.factories import http_client, make_user

TODAY = date(2026, 9, 25)


async def test_activity_ping_is_idempotent(db, monkeypatch) -> None:
    monkeypatch.setattr(activity, "local_today", lambda: TODAY)
    user = await make_user(db)
    async with await http_client(db, user) as client:
        assert (await client.post("/api/activity")).status_code == 204
        assert (await client.post("/api/activity")).status_code == 204
    rows = (
        await db.scalars(sa.select(UserActivityDay).where(UserActivityDay.user_id == user.id))
    ).all()
    assert [row.day for row in rows] == [TODAY]


async def test_activity_requires_login(db) -> None:
    async with await http_client() as client:
        assert (await client.post("/api/activity")).status_code == 401
        assert (await client.get("/api/stats/streak")).status_code == 401


async def test_streak_endpoint(db, monkeypatch) -> None:
    monkeypatch.setattr(activity, "local_today", lambda: TODAY)
    user = await make_user(db)
    other = await make_user(db, username="bob")
    for offset in (1, 2, 5, 6, 7, 8):
        db.add(UserActivityDay(user_id=user.id, day=TODAY - timedelta(days=offset)))
    db.add(UserActivityDay(user_id=other.id, day=TODAY))
    await db.flush()
    async with await http_client(db, user) as client:
        assert (await client.get("/api/stats/streak")).json() == {"current": 2, "best": 4}
        await client.post("/api/activity")
        assert (await client.get("/api/stats/streak")).json() == {"current": 3, "best": 4}
