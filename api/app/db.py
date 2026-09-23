from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)

AsyncSessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False)

_session_override: AsyncSession | None = None


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a database session."""
    async with AsyncSessionLocal() as session:
        yield session


def override_session_scope(session: AsyncSession | None) -> None:
    """Test hook: make `session_scope()` yield `session` instead of a fresh one."""
    global _session_override
    _session_override = session


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """A session for code outside FastAPI dependency injection (the MCP tools
    and the OAuth provider the MCP SDK calls)."""
    if _session_override is not None:
        yield _session_override
        return
    async with AsyncSessionLocal() as session:
        yield session
