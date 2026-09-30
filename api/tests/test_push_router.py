import pytest
import sqlalchemy as sa
from pydantic import ValidationError

from app.models.push import PushSubscription
from app.schemas.push import PushSubscriptionIn
from tests.factories import http_client, make_user


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://web.push.apple.com/device/token",
        "https://fcm.googleapis.com/fcm/send/token",
        "https://updates.push.services.mozilla.com/wpush/v2/token",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ],
)
def test_push_endpoint_accepts_known_push_service_hosts(endpoint: str) -> None:
    payload = PushSubscriptionIn.model_validate(
        {"endpoint": endpoint, "keys": {"p256dh": "key", "auth": "secret"}}
    )

    assert payload.endpoint == endpoint


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://web.push.apple.com/device/token",
        "https://example.com/x",
        "https://web.push.apple.com.evil.com/x",
        "https://notify.windows.com/x",
        "not a url",
        r"https://evil.com\.notify.windows.com/x",
        r"https://evil.com\.web.push.apple.com/x",
        "https://evil.com\t.notify.windows.com/x",
        "https://.notify.windows.com/x",
        "https://web.push.apple.com/ x",
        "https://web.push.apple.com@evil.com/",
        "https://web.push.apple.com:8443/x",
        "https://evilnotify.windows.com/x",
    ],
)
def test_push_endpoint_rejects_non_https_or_unlisted_hosts(endpoint: str) -> None:
    with pytest.raises(ValidationError):
        PushSubscriptionIn.model_validate(
            {"endpoint": endpoint, "keys": {"p256dh": "key", "auth": "secret"}}
        )


async def test_subscriptions_upsert_by_endpoint_and_reassign_owner(db) -> None:
    alice = await make_user(db, username="alice")
    bob = await make_user(db, username="bob")
    endpoint = "https://web.push.apple.com/device/shared"
    body = {"endpoint": endpoint, "keys": {"p256dh": "key-1", "auth": "auth-1"}}

    async with await http_client(db, alice) as client:
        first = await client.post("/api/push/subscriptions", json=body)
        assert first.status_code == 204

    body["keys"] = {"p256dh": "key-2", "auth": "auth-2"}
    async with await http_client(db, bob) as client:
        second = await client.post("/api/push/subscriptions", json=body)
    assert second.status_code == 204

    rows = (await db.scalars(sa.select(PushSubscription))).all()
    assert len(rows) == 1
    assert rows[0].user_id == bob.id
    assert rows[0].p256dh == "key-2"
    assert rows[0].auth == "auth-2"


async def test_unsubscribe_only_deletes_the_current_users_endpoint(db) -> None:
    alice = await make_user(db, username="alice")
    bob = await make_user(db, username="bob")
    endpoint = "https://web.push.apple.com/device/alice"
    db.add(PushSubscription(user_id=alice.id, endpoint=endpoint, p256dh="key", auth="auth"))
    await db.flush()

    async with await http_client(db, bob) as client:
        response = await client.post("/api/push/unsubscribe", json={"endpoint": endpoint})
    assert response.status_code == 204
    assert await db.scalar(
        sa.select(PushSubscription.id).where(PushSubscription.endpoint == endpoint)
    ) is not None


async def test_unsubscribe_deletes_own_endpoint_and_is_idempotent(db) -> None:
    alice = await make_user(db, username="alice")
    endpoint = "https://web.push.apple.com/device/alice"
    db.add(PushSubscription(user_id=alice.id, endpoint=endpoint, p256dh="key", auth="auth"))
    await db.flush()

    async with await http_client(db, alice) as client:
        response = await client.post("/api/push/unsubscribe", json={"endpoint": endpoint})
        repeated = await client.post("/api/push/unsubscribe", json={"endpoint": endpoint})

    assert response.status_code == 204
    assert repeated.status_code == 204
    assert await db.scalar(
        sa.select(PushSubscription.id).where(PushSubscription.endpoint == endpoint)
    ) is None


async def test_unsubscribe_unknown_endpoint_is_idempotent(db) -> None:
    alice = await make_user(db, username="alice")
    async with await http_client(db, alice) as client:
        response = await client.post(
            "/api/push/unsubscribe",
            json={"endpoint": "https://web.push.apple.com/device/missing"},
        )

    assert response.status_code == 204


async def test_push_write_requires_csrf_header(db) -> None:
    user = await make_user(db)
    async with await http_client(db, user, csrf=False) as client:
        response = await client.post(
            "/api/push/subscriptions",
            json={"endpoint": "https://web.push.apple.com/device/test", "keys": {"p256dh": "k", "auth": "a"}},
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "csrf"}


async def test_push_routes_require_authentication() -> None:
    async with await http_client() as client:
        response = await client.get("/api/push/config")

    assert response.status_code == 401


async def test_push_config_only_returns_public_key_when_enabled(db, monkeypatch) -> None:
    from app.config import settings

    user = await make_user(db)
    monkeypatch.setattr(settings, "vapid_public_key", "")
    monkeypatch.setattr(settings, "vapid_private_key", "")
    monkeypatch.setattr(settings, "vapid_subject", "")
    async with await http_client(db, user) as client:
        disabled = await client.get("/api/push/config")
    assert disabled.status_code == 200
    assert disabled.json() == {"public_key": None}

    monkeypatch.setattr(settings, "vapid_public_key", "public")
    monkeypatch.setattr(settings, "vapid_private_key", "private")
    monkeypatch.setattr(settings, "vapid_subject", "mailto:test@example.com")
    async with await http_client(db, user) as client:
        enabled = await client.get("/api/push/config")
    assert enabled.status_code == 200
    assert enabled.json() == {"public_key": "public"}
    assert "private" not in enabled.text
