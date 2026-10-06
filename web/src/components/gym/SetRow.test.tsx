import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkoutSet } from "../../api/gym";
import SetRow from "./SetRow";

const baseSet: WorkoutSet = {
  id: 11, weight_kg: 80, reps: 8, duration_s: null, completed_at: null,
  previous: { weight_kg: 77.5, reps: 8, duration_s: null },
};

function setup(set: WorkoutSet = baseSet) {
  const handlers = {
    onSave: vi.fn(), onComplete: vi.fn(), onUncomplete: vi.fn(), onDelete: vi.fn(),
  };
  render(<SetRow index={0} tracking="weight_reps" set={set} {...handlers} />);
  return handlers;
}

describe("SetRow", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the previous values and copies them on tap", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Usa precedente serie 1" }));
    expect(screen.getByLabelText("kg serie 1")).toHaveValue("77,5");
    act(() => vi.advanceTimersByTime(500));
    expect(onSave).toHaveBeenCalledWith({ weight_kg: 77.5, reps: 8, duration_s: null });
  });

  it("debounces edits", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("kg serie 1"), { target: { value: "85" } });
    fireEvent.change(screen.getByLabelText("Rip. serie 1"), { target: { value: "6" } });
    expect(onSave).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(500));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ weight_kg: 85, reps: 6, duration_s: null });
  });

  it("completes with the typed values and drops the pending save", () => {
    const { onSave, onComplete } = setup();
    fireEvent.change(screen.getByLabelText("kg serie 1"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Completa serie 1" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(onComplete).toHaveBeenCalledWith({ weight_kg: 90, reps: 8, duration_s: null });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not save a pending edit when the set is deleted and unmounted", () => {
    const handlers = {
      onSave: vi.fn(), onComplete: vi.fn(), onUncomplete: vi.fn(), onDelete: vi.fn(),
    };
    const view = render(
      <SetRow index={0} tracking="weight_reps" set={baseSet} {...handlers} />,
    );
    fireEvent.change(screen.getByLabelText("kg serie 1"), { target: { value: "85" } });
    fireEvent.click(screen.getByRole("button", { name: "Serie 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Elimina serie" }));
    view.unmount();
    expect(handlers.onDelete).toHaveBeenCalledOnce();
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("opens the set menu aligned to the left of the narrow number cell", () => {
    const originalInnerWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
    const originalInnerHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
    const rect = (top: number, left: number, width: number, height: number) => ({
      top, left, width, height, bottom: top + height, right: left + width,
      x: left, y: top, toJSON: () => ({}),
    });

    try {
      Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute("role") === "menu") return rect(0, 0, 224, 190) as DOMRect;
        if (
          this.getAttribute("aria-label") === "Serie 1"
          || this.querySelector('button[aria-label="Serie 1"]')
        ) return rect(100, 32, 36, 36) as DOMRect;
        return rect(0, 0, 0, 0) as DOMRect;
      });

      setup();
      fireEvent.click(screen.getByRole("button", { name: "Serie 1" }));
      const menu = screen.getByRole("menu");
      expect(menu).toHaveAttribute("data-align", "left");
      expect(menu).toHaveAttribute("data-placement", "bottom");
      expect(screen.getByRole("menuitem", { name: "Elimina serie" })).toBeInTheDocument();
    } finally {
      vi.restoreAllMocks();
      if (originalInnerWidth) Object.defineProperty(window, "innerWidth", originalInnerWidth);
      if (originalInnerHeight) Object.defineProperty(window, "innerHeight", originalInnerHeight);
    }
  });

  it("unticks a completed set", () => {
    const { onUncomplete } = setup({ ...baseSet, completed_at: "2026-09-24T18:00:00Z" });
    fireEvent.click(screen.getByRole("button", { name: "Annulla serie 1" }));
    expect(onUncomplete).toHaveBeenCalled();
  });
});
