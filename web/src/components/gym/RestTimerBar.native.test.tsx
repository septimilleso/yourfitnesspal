import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../../api/gym";
import RestTimerBar from "./RestTimerBar";

const platform = vi.hoisted(() => ({ native: true }));
const haptics = vi.hoisted(() => ({ impact: vi.fn(), notification: vi.fn() }));

vi.mock("../../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/haptics", () => ({
  Haptics: haptics,
  ImpactStyle: { Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS" },
}));
vi.mock("../../lib/restTimer", async () => {
  const actual = await vi.importActual<typeof import("../../lib/restTimer")>("../../lib/restTimer");
  return { ...actual, beep: vi.fn(), vibrate: vi.fn() };
});

const NOW = Date.parse("2026-09-24T18:00:00Z");

function workout(restEndsAt: string | null): Workout {
  return {
    id: 1, name: "Giorno 1", template_id: null, status: "in_progress",
    started_at: "2026-09-24T17:30:00Z", finished_at: null, rest_ends_at: restEndsAt,
    rest_total_s: 90, server_now: new Date(NOW).toISOString(), exercises: [], template_diff: [],
  };
}

describe("RestTimerBar haptics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    platform.native = true;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("fires one success notification when zero is observed in time on native", () => {
    const { rerender } = render(
      <RestTimerBar workout={workout("2026-09-24T18:00:05Z")} onAdjust={vi.fn()} onSkip={vi.fn()} />,
    );
    act(() => vi.advanceTimersByTime(2000));
    vi.setSystemTime(NOW + 9000);
    act(() => vi.advanceTimersByTime(250));

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(haptics.notification).toHaveBeenCalledTimes(1);
    expect(haptics.notification).toHaveBeenCalledWith({ type: "SUCCESS" });

    rerender(<RestTimerBar workout={workout("2026-09-24T18:00:05Z")} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    act(() => vi.advanceTimersByTime(6000));
    expect(haptics.notification).toHaveBeenCalledTimes(1);
  });

  it("does not fire when zero is observed more than 5 seconds late on native", () => {
    render(<RestTimerBar workout={workout("2026-09-24T18:00:05Z")} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("timer")).toBeInTheDocument();

    vi.setSystemTime(NOW + 60_000);
    act(() => vi.advanceTimersByTime(250));

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(haptics.notification).not.toHaveBeenCalled();
  });

  it("does not call the plugin on web", () => {
    platform.native = false;
    render(<RestTimerBar workout={workout("2026-09-24T18:00:05Z")} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    act(() => vi.advanceTimersByTime(6000));

    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(haptics.notification).not.toHaveBeenCalled();
    expect(haptics.impact).not.toHaveBeenCalled();
  });
});
