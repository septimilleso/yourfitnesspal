import asyncio

import pytest

from app.config import Settings
from app.services import rest_notifier
from app.services.rest_notifier import RestNotifier


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
async def test_start_without_vapid_keys_does_not_create_task() -> None:
    notifier = RestNotifier(Settings(_env_file=None))

    await notifier.start()

    assert notifier.task is None
    assert notifier.http_session is None
    await notifier.stop()
