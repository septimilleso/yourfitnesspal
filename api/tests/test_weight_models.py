"""Constraints on body-weight records (needs Postgres)."""

from datetime import date

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError

from app.models.user import User
from app.models.weight import BodyWeight
from tests.factories import make_user


async def test_body_weight_is_unique_per_user_and_date(db) -> None:
    user = await make_user(db)
    db.add(BodyWeight(user_id=user.id, date=date(2026, 10, 2), weight_kg=78.4))
    await db.flush()

    db.add(BodyWeight(user_id=user.id, date=date(2026, 10, 2), weight_kg=79.0))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_deleting_user_cascades_to_body_weights(db) -> None:
    user = await make_user(db)
    weight = BodyWeight(user_id=user.id, date=date(2026, 10, 2), weight_kg=78.4)
    db.add(weight)
    await db.flush()

    await db.execute(sa.delete(User).where(User.id == user.id))

    assert await db.scalar(sa.select(BodyWeight.id).where(BodyWeight.id == weight.id)) is None
