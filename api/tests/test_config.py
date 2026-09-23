"""Settings derived values and the out-of-DI session hook (no database needed)."""

from app.config import Settings
from app.db import override_session_scope, session_scope


def test_mcp_resource_url_strips_trailing_slash() -> None:
    settings = Settings(public_base_url="https://fit.example.com/")
    assert settings.mcp_resource_url == "https://fit.example.com/mcp"


def test_new_settings_defaults() -> None:
    settings = Settings()
    assert settings.app_timezone == "Europe/Rome"
    assert settings.oauth_access_token_minutes == 60
    assert settings.oauth_refresh_token_days == 30


async def test_session_scope_yields_override() -> None:
    sentinel = object()
    override_session_scope(sentinel)  # type: ignore[arg-type]
    try:
        async with session_scope() as session:
            assert session is sentinel
    finally:
        override_session_scope(None)
