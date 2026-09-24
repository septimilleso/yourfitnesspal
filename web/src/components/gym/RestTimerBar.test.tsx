import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../../api/gym";
import { beep, vibrate } from "../../lib/restTimer";
import RestTimerBar from "./RestTimerBar";

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

describe("RestTimerBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing without a running rest", () => {
    render(<RestTimerBar workout={workout(null)} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("counts down, then beeps once and hides", () => {
    render(<RestTimerBar workout={workout("2026-09-24T18:00:05Z")} onAdjust={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole("timer")).toHaveTextContent("0:05");
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("timer")).toHaveTextContent("0:03");
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(beep).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(4000));
    expect(beep).toHaveBeenCalledTimes(1);
  });

  it("adjusts and skips", () => {
    const onAdjust = vi.fn();
    const onSkip = vi.fn();
    render(<RestTimerBar workout={workout("2026-09-24T18:01:00Z")} onAdjust={onAdjust} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole("button", { name: "-15s" }));
    fireEvent.click(screen.getByRole("button", { name: "+15s" }));
    fireEvent.click(screen.getByRole("button", { name: "Salta" }));
    expect(onAdjust.mock.calls).toEqual([[-15], [15]]);
    expect(onSkip).toHaveBeenCalled();
  });
});
