"""OAuth storage tables (needs Postgres with migrations applied)."""

from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from app.models.oauth import OAuthAuthCode, OAuthClient, OAuthTokenPair
from app.models.user import User
from tests.factories import make_user


async def test_deleting_a_user_cascades_codes_and_tokens(db) -> None:
    user = await make_user(db)
    now = datetime.now(UTC)
    db.add(OAuthClient(client_id="client-1", client_name="Claude", info={"redirect_uris": []}))
    await db.flush()
    db.add(
        OAuthAuthCode(
            code_hash="a" * 64,
            client_id="client-1",
            user_id=user.id,
            redirect_uri="https://claude.ai/cb",
            redirect_uri_provided_explicitly=True,
            code_challenge="c" * 43,
            scopes=[],
            expires_at=now + timedelta(minutes=5),
        )
    )
    db.add(
        OAuthTokenPair(
            user_id=user.id,
            client_id="client-1",
            family_id="f1",
            access_token_hash="b" * 64,
            access_expires_at=now + timedelta(hours=1),
            refresh_token_hash="d" * 64,
            refresh_expires_at=now + timedelta(days=30),
            scopes=[],
            auth_version=user.auth_version,
        )
    )
    await db.flush()

    await db.execute(sa.delete(User).where(User.id == user.id))

    assert await db.scalar(sa.select(sa.func.count()).select_from(OAuthAuthCode)) == 0
    assert await db.scalar(sa.select(sa.func.count()).select_from(OAuthTokenPair)) == 0
    assert await db.scalar(sa.select(sa.func.count()).select_from(OAuthClient)) == 1
