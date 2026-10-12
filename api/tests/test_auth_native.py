"""Native client login: the signed challenge travels in the body and in the
`X-YFP-Challenge` header, and the session token is returned in the body.

Needs a live Postgres instance with migrations applied -- same DATABASE_URL
setup as test_auth_sessions.py. Each DB-backed test runs inside a transaction
that's rolled back afterward (via a `get_session` dependency override).

The native client has no cookie jar, so the helpers below clear `client.cookies`
after every response: a passing test cannot rely on a cookie it should not have.
"""

import pyotp
import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import engine, get_session
from app.main import app
from tests.test_auth_sessions import (
    NEW_PASSWORD,
    PASSWORD,
    _client,
    _make_user,
    _session_id,
)

NATIVE = {"X-YFP-Client": "native"}


@pytest.fixture
async def session():
    async with engine.connect() as connection:
        trans = await connection.begin()
        async with AsyncSession(bind=connection, expire_on_commit=False) as sess:
            app.dependency_overrides[get_session] = lambda: sess
            try:
                yield sess
            finally:
                app.dependency_overrides.pop(get_session, None)
        await trans.rollback()


async def _call(client: AsyncClient, method: str, url: str, **kwargs) -> Response:
    response = await client.request(method, url, **kwargs)
    # Drop whatever cookie the response set: the native client never keeps it.
    client.cookies.clear()
    return response


async def _native_login(client: AsyncClient, password: str = PASSWORD) -> Response:
    return await _call(
        client, "POST", "/api/auth/login",
        json={"username": "alice", "password": password}, headers=NATIVE,
    )


def _with_challenge(challenge: str) -> dict[str, str]:
    return {**NATIVE, "X-YFP-Challenge": challenge}


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_native_login_and_totp_return_token_usable_as_bearer(session: AsyncSession) -> None:
    _, secret = await _make_user(session)
    async with await _client() as client:
        login = await _native_login(client)
        assert login.status_code == 200
        assert set(login.json()) == {"status", "must_change_password", "challenge"}
        assert login.json()["status"] == "totp_required"
        assert "login_challenge" in login.cookies

        totp = await _call(
            client, "POST", "/api/auth/totp", json={"code": pyotp.TOTP(secret).now()},
            headers=_with_challenge(login.json()["challenge"]),
        )

    assert totp.status_code == 200
    assert set(totp.json()) == {"status", "token"}
    assert totp.json()["status"] == "ok"
    token = totp.json()["token"]
    assert await _session_id(session, token) is not None

    async with await _client() as bearer_client:
        protected = await bearer_client.get("/api/health/protected", headers=_bearer(token))

    assert protected.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("must_change_password", [False, True])
async def test_native_setup_flow_returns_token_usable_as_bearer(
    session: AsyncSession, must_change_password: bool,
) -> None:
    await _make_user(session, totp_enabled=False, must_change_password=must_change_password)
    async with await _client() as client:
        login = await _native_login(client)
        assert login.status_code == 200
        assert login.json()["status"] == "setup_required"
        assert login.json()["must_change_password"] is must_change_password
        challenge = login.json()["challenge"]

        start = await _call(client, "POST", "/api/auth/setup/start", headers=_with_challenge(challenge))
        assert start.status_code == 200
        secret = start.json()["secret"]

        complete_body = {"code": pyotp.TOTP(secret).now()}
        if must_change_password:
            complete_body["new_password"] = NEW_PASSWORD
        complete = await _call(
            client, "POST", "/api/auth/setup/complete", json=complete_body,
            headers=_with_challenge(challenge),
        )

    assert complete.status_code == 200
    assert set(complete.json()) == {"status", "recovery_codes", "token"}
    assert len(complete.json()["recovery_codes"]) == 10
    token = complete.json()["token"]

    async with await _client() as bearer_client:
        protected = await bearer_client.get("/api/health/protected", headers=_bearer(token))

    assert protected.status_code == 200


@pytest.mark.asyncio
async def test_tampered_challenge_header_is_rejected(session: AsyncSession) -> None:
    _, secret = await _make_user(session)
    async with await _client() as client:
        login = await _native_login(client)
        challenge = login.json()["challenge"]
        # Change the first character of the signed payload: the signature no longer matches.
        tampered = ("X" if challenge[0] != "X" else "Y") + challenge[1:]

        response = await _call(
            client, "POST", "/api/auth/totp", json={"code": pyotp.TOTP(secret).now()},
            headers=_with_challenge(tampered),
        )

    assert response.status_code == 401
    assert response.json() == {"detail": "challenge scaduto"}


@pytest.mark.asyncio
async def test_expired_challenge_header_is_rejected(session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    _, secret = await _make_user(session)
    async with await _client() as client:
        login = await _native_login(client)
        challenge = login.json()["challenge"]
        monkeypatch.setattr(settings, "login_challenge_max_age_seconds", -1)

        response = await _call(
            client, "POST", "/api/auth/totp", json={"code": pyotp.TOTP(secret).now()},
            headers=_with_challenge(challenge),
        )

    assert response.status_code == 401
    assert response.json() == {"detail": "challenge scaduto"}


@pytest.mark.asyncio
async def test_web_login_body_has_no_challenge_without_native_header(session: AsyncSession) -> None:
    await _make_user(session)
    async with await _client() as client:
        response = await client.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})

    assert response.status_code == 200
    assert response.json() == {"status": "totp_required", "must_change_password": False}
    assert "login_challenge" in response.cookies


@pytest.mark.asyncio
async def test_web_totp_body_has_no_token_without_native_header(session: AsyncSession) -> None:
    _, secret = await _make_user(session)
    async with await _client() as client:
        assert (await client.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})).status_code == 200
        totp = await client.post("/api/auth/totp", json={"code": pyotp.TOTP(secret).now()})

    assert totp.status_code == 200
    assert totp.json() == {"status": "ok"}
    assert "session" in totp.cookies


@pytest.mark.asyncio
async def test_web_setup_body_has_no_token_without_native_header(session: AsyncSession) -> None:
    await _make_user(session, totp_enabled=False)
    async with await _client() as client:
        assert (await client.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})).status_code == 200
        secret = (await client.post("/api/auth/setup/start")).json()["secret"]
        complete = await client.post("/api/auth/setup/complete", json={"code": pyotp.TOTP(secret).now()})

    assert complete.status_code == 200
    assert set(complete.json()) == {"status", "recovery_codes"}
    assert "session" in complete.cookies


@pytest.mark.asyncio
async def test_native_wrong_password_five_times_then_rate_limited(session: AsyncSession) -> None:
    await _make_user(session)
    async with await _client() as client:
        for _ in range(5):
            response = await _native_login(client, password="wrong-password")
            assert response.status_code == 401
            assert response.json() == {"detail": "credenziali non valide"}

        limited = await _native_login(client, password="wrong-password")

    assert limited.status_code == 429
    assert limited.json() == {"detail": "too many attempts"}
