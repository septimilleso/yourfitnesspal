import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkoutSet } from "../../api/gym";
import SetRow from "./SetRow";

const platform = vi.hoisted(() => ({ native: true }));
const haptics = vi.hoisted(() => ({ impact: vi.fn(), notification: vi.fn() }));

vi.mock("../../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/haptics", () => ({
  Haptics: haptics,
  ImpactStyle: { Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS" },
}));

const baseSet: WorkoutSet = {
  id: 11, weight_kg: 80, reps: 8, duration_s: null, completed_at: null,
  previous: { weight_kg: 77.5, reps: 8, duration_s: null },
};

function renderRow(set: WorkoutSet = baseSet) {
  const handlers = {
    onSave: vi.fn(), onComplete: vi.fn(), onUncomplete: vi.fn(), onDelete: vi.fn(),
  };
  render(<SetRow index={0} tracking="weight_reps" set={set} {...handlers} />);
  return handlers;
}

describe("SetRow haptics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.native = true;
  });
  afterEach(() => cleanup());

  it("fires a light impact once when a set is completed on native", () => {
    const { onComplete } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Completa serie 1" }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(haptics.impact).toHaveBeenCalledTimes(1);
    expect(haptics.impact).toHaveBeenCalledWith({ style: "LIGHT" });
  });

  it("does not fire when a completed set is uncompleted on native", () => {
    const { onUncomplete } = renderRow({ ...baseSet, completed_at: "2026-10-12T10:00:00Z" });
    fireEvent.click(screen.getByRole("button", { name: "Annulla serie 1" }));

    expect(onUncomplete).toHaveBeenCalledTimes(1);
    expect(haptics.impact).not.toHaveBeenCalled();
  });

  it("does not call the plugin on web", () => {
    platform.native = false;
    const { onComplete } = renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Completa serie 1" }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(haptics.impact).not.toHaveBeenCalled();
    expect(haptics.notification).not.toHaveBeenCalled();
  });
});
