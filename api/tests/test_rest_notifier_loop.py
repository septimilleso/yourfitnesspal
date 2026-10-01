import asyncio
import base64

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.config import Settings
from app.services import rest_notifier
from app.services.rest_notifier import RestNotifier


def _private_key() -> str:
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
    return base64.urlsafe_b64encode(private_bytes).decode("ascii").rstrip("=")


@pytest.mark.asyncio
async def test_run_loop_logs_errors_and_continues(monkeypatch) -> None:
    second_call = asyncio.Event()
    calls = 0

    async def notify_due_rests(sender, now):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("temporary failure")
        second_call.set()

    monkeypatch.setattr(rest_notifier, "notify_due_rests", notify_due_rests)
    task = asyncio.create_task(rest_notifier.run_loop(None, interval=0))
    try:
        await asyncio.wait_for(second_call.wait(), timeout=1)
        assert calls >= 2
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_start_with_invalid_subject_does_not_create_task_or_keep_session(
    monkeypatch, caplog
) -> None:
    sessions = []

    class FakeSession:
        closed = False

        async def close(self):
            self.closed = True

    def make_session():
        session = FakeSession()
        sessions.append(session)
        return session

    monkeypatch.setattr(rest_notifier, "ClientSession", make_session)
    settings = Settings(
        _env_file=None,
        vapid_public_key="public",
        vapid_private_key=_private_key(),
        vapid_subject="tua@email.it",
    )
    notifier = RestNotifier(settings)

    await notifier.start()

    assert notifier.task is None
    assert notifier.http_session is None
    assert len(sessions) == 1 and sessions[0].closed
    assert "Rest notifier disabled: invalid VAPID_SUBJECT" in caplog.text


@pytest.mark.asyncio
async def test_start_with_valid_subject_creates_task_and_stop_closes_session(monkeypatch) -> None:
    started = asyncio.Event()

    async def run_loop(sender):
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(rest_notifier, "run_loop", run_loop)
    settings = Settings(
        _env_file=None,
        vapid_public_key="public",
        vapid_private_key=_private_key(),
        vapid_subject="mailto:a@example.com",
    )
    notifier = RestNotifier(settings)

    await notifier.start()
    await asyncio.wait_for(started.wait(), timeout=1)

    assert notifier.task is not None
    assert notifier.http_session is not None
    assert not notifier.http_session.closed
    await notifier.stop()
    assert notifier.task is None
    assert notifier.http_session is None


@pytest.mark.asyncio
async def test_start_without_vapid_keys_does_not_create_task() -> None:
    notifier = RestNotifier(Settings(_env_file=None))

    await notifier.start()

    assert notifier.task is None
    assert notifier.http_session is None
    await notifier.stop()
