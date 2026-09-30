"""Concurrent claims across independent database sessions (needs Postgres)."""

import asyncio
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.db import AsyncSessionLocal
from app.models.user import User
from app.models.workout import Workout, WorkoutStatus
from app.services.rest_notifier import claim_due_rests
from tests.factories import make_user

T0 = datetime(2026, 9, 24, 18, 0, tzinfo=UTC)


async def test_concurrent_claims_return_a_rest_once() -> None:
    username = "zzq-push-race"
    now = T0 + timedelta(seconds=91)
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(sa.delete(User).where(User.username == username))
            await db.commit()

        async with AsyncSessionLocal() as db:
            user = await make_user(db, username=username)
            db.add(Workout(
                user_id=user.id,
                name="Race",
                status=WorkoutStatus.in_progress,
                started_at=T0,
                rest_ends_at=T0 + timedelta(seconds=90),
            ))
            await db.commit()

        async with AsyncSessionLocal() as session_a:
            rests_a = await asyncio.wait_for(claim_due_rests(session_a, now), timeout=10)
            async with AsyncSessionLocal() as session_b:
                task_b = asyncio.create_task(claim_due_rests(session_b, now))
                try:
                    await asyncio.sleep(0.1)
                    assert not task_b.done()
                    await session_a.commit()
                    rests_b = await asyncio.wait_for(task_b, timeout=10)
                    await session_b.commit()
                finally:
                    if not task_b.done():
                        task_b.cancel()
                        try:
                            await asyncio.wait_for(task_b, timeout=5)
                        except asyncio.CancelledError:
                            pass

        assert len(rests_a) == 1
        assert len(rests_b) == 0
    finally:
        async with AsyncSessionLocal() as db:
            await db.execute(sa.delete(User).where(User.username == username))
            await db.commit()
