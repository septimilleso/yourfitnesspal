"""Cleanup of dead OAuth codes and tokens (needs Postgres)."""

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.mcp.oauth import purge_expired
from app.models.oauth import OAuthAuthCode, OAuthClient, OAuthTokenPair
from tests.factories import make_user


def _pair(user, suffix: str, **times) -> OAuthTokenPair:
    now = datetime.now(UTC)
    values = {
        "access_expires_at": now + timedelta(hours=1),
        "refresh_expires_at": now + timedelta(days=30),
        **times,
    }
    return OAuthTokenPair(
        user_id=user.id, client_id="client-1", family_id=suffix,
        access_token_hash=f"a{suffix}".ljust(64, "0"), refresh_token_hash=f"r{suffix}".ljust(64, "0"),
        scopes=[], auth_version=user.auth_version, **values,
    )


async def test_purge_removes_only_dead_rows(db) -> None:
    user = await make_user(db)
    now = datetime.now(UTC)
    db.add(OAuthClient(client_id="client-1", client_name="Claude", info={}))
    await db.flush()
    db.add_all([
        OAuthAuthCode(code_hash="1".ljust(64, "0"), client_id="client-1", user_id=user.id,
                      redirect_uri="https://claude.ai/cb", redirect_uri_provided_explicitly=True,
                      code_challenge="c" * 43, scopes=[], expires_at=now - timedelta(days=2)),
        OAuthAuthCode(code_hash="2".ljust(64, "0"), client_id="client-1", user_id=user.id,
                      redirect_uri="https://claude.ai/cb", redirect_uri_provided_explicitly=True,
                      code_challenge="c" * 43, scopes=[], expires_at=now + timedelta(minutes=5)),
        _pair(user, "live"),
        _pair(user, "expired", refresh_expires_at=now - timedelta(seconds=1)),
        _pair(user, "oldrev", revoked_at=now - timedelta(days=31)),
        _pair(user, "newrev", revoked_at=now - timedelta(days=1)),
    ])
    await db.flush()

    assert await purge_expired(db) == (1, 2)
    left = set((await db.scalars(sa.select(OAuthTokenPair.family_id))).all())
    assert left == {"live", "newrev"}
