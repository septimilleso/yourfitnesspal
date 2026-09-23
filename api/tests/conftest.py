"""Fixtures shared by the MCP/OAuth test modules.

Older modules define their own `session` fixture; this one is named `db`
so it never shadows them. It wires the same rolled-back session into both
FastAPI's `get_session` dependency and `app.db.session_scope()` (used by
the MCP tools and the OAuth provider), so every code path in a test sees
the same uncommitted data.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, get_session, override_session_scope
from app.main import app


@pytest.fixture
async def db():
    async with engine.connect() as connection:
        trans = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as sess:
            app.dependency_overrides[get_session] = lambda: sess
            override_session_scope(sess)
            try:
                yield sess
            finally:
                override_session_scope(None)
                app.dependency_overrides.pop(get_session, None)
        await trans.rollback()
