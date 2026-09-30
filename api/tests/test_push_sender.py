import base64
from types import SimpleNamespace

import aiohttp
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException

from app.config import Settings
from app.services import push
from app.services.rest_notifier import PushResult


def _private_key() -> str:
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
    return base64.urlsafe_b64encode(private_bytes).decode("ascii").rstrip("=")


def _settings() -> Settings:
    private_key = _private_key()
    return Settings(
        _env_file=None,
        vapid_public_key="public",
        vapid_private_key=private_key,
        vapid_subject="mailto:you@example.com",
    )


@pytest.mark.asyncio
async def test_sender_uses_vapid_claims_and_urgent_header(monkeypatch) -> None:
    calls = []

    async def webpush_async(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(push, "webpush_async", webpush_async)
    http_session = object()
    sender = push.make_webpush_sender(_settings(), http_session)

    result = await sender({"endpoint": "https://push.example/a"}, '{"title":"Done"}')

    assert result is PushResult.sent
    assert calls[0]["vapid_claims"]["sub"] == "mailto:you@example.com"
    assert calls[0]["headers"] == {"Urgency": "high"}
    assert calls[0]["ttl"] == 60
    assert calls[0]["timeout"] == 5
    assert calls[0]["aiohttp_session"] is http_session


@pytest.mark.asyncio
async def test_sender_creates_fresh_vapid_claims_for_every_push(monkeypatch) -> None:
    claims = []

    async def webpush_async(**kwargs):
        kwargs["vapid_claims"]["aud"] = kwargs["subscription_info"]["endpoint"]
        claims.append(kwargs["vapid_claims"])

    monkeypatch.setattr(push, "webpush_async", webpush_async)
    sender = push.make_webpush_sender(_settings(), object())

    await sender({"endpoint": "https://push.example/a"}, "{}")
    await sender({"endpoint": "https://push.example/b"}, "{}")

    assert claims[0] is not claims[1]
    assert claims[0]["aud"] == "https://push.example/a"
    assert claims[1]["aud"] == "https://push.example/b"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [404, 410])
async def test_sender_maps_gone_statuses(monkeypatch, status: int) -> None:
    async def webpush_async(**kwargs):
        raise WebPushException("gone", response=SimpleNamespace(status=status))

    monkeypatch.setattr(push, "webpush_async", webpush_async)
    sender = push.make_webpush_sender(_settings(), object())

    assert await sender({"endpoint": "https://push.example/a"}, "{}") is PushResult.gone


@pytest.mark.asyncio
async def test_sender_maps_other_webpush_status_to_failed(monkeypatch) -> None:
    async def webpush_async(**kwargs):
        raise WebPushException("failed", response=SimpleNamespace(status=500))

    monkeypatch.setattr(push, "webpush_async", webpush_async)
    sender = push.make_webpush_sender(_settings(), object())

    assert await sender({"endpoint": "https://push.example/a"}, "{}") is PushResult.failed


@pytest.mark.asyncio
async def test_sender_maps_aiohttp_errors_to_failed(monkeypatch) -> None:
    async def webpush_async(**kwargs):
        raise aiohttp.ClientError("network error")

    monkeypatch.setattr(push, "webpush_async", webpush_async)
    sender = push.make_webpush_sender(_settings(), object())

    assert await sender({"endpoint": "https://push.example/a"}, "{}") is PushResult.failed
