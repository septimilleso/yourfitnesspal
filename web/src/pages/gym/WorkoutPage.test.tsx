import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../../api/gym";
import { useActiveWorkout, useCancelWorkout, useFinishWorkout, useLiveMutation } from "../../api/gym";
import WorkoutPage from "./WorkoutPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useActiveWorkout: vi.fn(),
    useLiveMutation: vi.fn(),
    useFinishWorkout: vi.fn(),
    useCancelWorkout: vi.fn(),
  };
});

const workout: Workout = {
  id: 5, name: "Giorno 1", template_id: 2, status: "in_progress",
  started_at: new Date().toISOString(), finished_at: null, rest_ends_at: null, rest_total_s: null,
  server_now: new Date().toISOString(), template_diff: [],
  exercises: [
    {
      id: 21, rest_seconds: 90, superset_group: null, note: null,
      exercise: {
        id: 7, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
        secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
      },
      sets: [
        { id: 31, weight_kg: 80, reps: 8, duration_s: null, completed_at: "2026-09-24T18:00:00Z", previous: null },
        { id: 32, weight_kg: 80, reps: 8, duration_s: null, completed_at: null, previous: null },
      ],
    },
  ],
};

const finish = vi.fn();

function installVisualViewport(offsetTop: number) {
  const viewport = Object.assign(new EventTarget(), { offsetTop, height: 600 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  return viewport;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/gym/workout"]}>
      <Routes>
        <Route path="/gym/workout" element={<WorkoutPage />} />
        <Route path="/gym/history/:id" element={<div>Summary</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkoutPage", () => {
  beforeEach(() => {
    finish.mockReset();
    vi.mocked(useActiveWorkout).mockReturnValue({ data: workout, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
    vi.mocked(useLiveMutation).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useLiveMutation>);
    vi.mocked(useFinishWorkout).mockReturnValue({ mutate: finish, isPending: false } as unknown as ReturnType<typeof useFinishWorkout>);
    vi.mocked(useCancelWorkout).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useCancelWorkout>);
  });

  it("shows the exercises with their sets", () => {
    renderPage();
    expect(screen.getByRole("region", { name: "Barbell Squat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annulla serie 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Completa serie 2" })).toBeInTheDocument();
  });

  it("asks before discarding undone sets, then finishes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Termina" }));

    expect(confirm).toHaveBeenCalledWith("Ci sono 1 serie non completate. Verranno scartate.");
    expect(finish).toHaveBeenCalledWith({ workoutId: 5, discardIncomplete: true }, expect.anything());
  });

  it("does not finish when the user keeps the undone sets", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "Termina" }));
    expect(finish).not.toHaveBeenCalled();
  });

  it("explains when there is no live workout", () => {
    vi.mocked(useActiveWorkout).mockReturnValue({ data: null, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
    renderPage();
    expect(screen.getByText("Nessun allenamento in corso.")).toBeInTheDocument();
  });

  describe("WorkoutPage header and visual viewport", () => {
    beforeEach(() => {
      const now = new Date();
      vi.mocked(useActiveWorkout).mockReturnValue({
        data: {
          ...workout,
          rest_ends_at: new Date(now.getTime() + 90_000).toISOString(),
          rest_total_s: 90,
          server_now: now.toISOString(),
        },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useActiveWorkout>);
    });

    afterEach(() => {
      delete (window as unknown as { visualViewport?: VisualViewport }).visualViewport;
    });

    it("keeps the header in the visible area when the visual viewport moves", () => {
      const viewport = installVisualViewport(0);
      renderPage();

      act(() => {
        viewport.offsetTop = 300;
        viewport.dispatchEvent(new Event("scroll"));
      });

      const header = screen.getByRole("timer").closest("header");
      expect(header).not.toBeNull();
      expect(header?.style.top).toBe("300px");
    });

    it("works without the visualViewport API", () => {
      renderPage();

      const timer = screen.getByRole("timer");
      const header = timer.closest("header");
      expect(header).not.toBeNull();
      expect(header?.style.top).toBe("");
    });
  });
});
