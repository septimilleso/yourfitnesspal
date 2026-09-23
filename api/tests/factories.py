"""Test data builders shared by the MCP/OAuth test modules."""

from typing import ClassVar

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password
from app.auth.sessions import create_session
from app.main import app
from app.models.food import Food
from app.models.user import Role, User

PASSWORD = "correct horse battery staple"

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


class _FakeRequest:
    headers: ClassVar[dict] = {}
    client = None


async def make_user(
    db: AsyncSession,
    *,
    username: str = "alice",
    role: Role = Role.user,
    permissions: list[str] | None = None,
) -> User:
    user = User(
        username=username, display_name=username.title(), role=role,
        permissions=permissions if permissions is not None else [],
        password_hash=hash_password(PASSWORD), must_change_password=False, totp_enabled=True,
    )
    db.add(user)
    await db.flush()
    return user


async def make_food(
    db: AsyncSession, *, name: str = "Pasta", brand: str | None = None, owner: User | None = None
) -> Food:
    food = Food(
        source="custom" if owner else "off", owner_user_id=owner.id if owner else None,
        name=name, brand=brand, nutriments=dict(NUTRIMENTS), raw=None,
    )
    db.add(food)
    await db.flush()
    return food


async def http_client(
    db: AsyncSession | None = None, user: User | None = None, *, csrf: bool = True
) -> AsyncClient:
    """An https client for the ASGI app, optionally logged in as `user`.

    `csrf=False` sends a wrong `X-Requested-With`, to exercise the CSRF gate.
    """
    client = AsyncClient(
        transport=ASGITransport(app=app), base_url="https://test",
        headers={"X-Requested-With": "yfp" if csrf else "nope"},
    )
    if user is not None:
        assert db is not None
        client.cookies.set("session", await create_session(db, user, _FakeRequest()))
    return client
