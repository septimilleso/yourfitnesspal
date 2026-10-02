import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../../api/gym";
import { useApplyToTemplate, useDeleteWorkout, useSaveAsTemplate, useWorkout } from "../../api/gym";
import WorkoutDetailPage from "./WorkoutDetailPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useWorkout: vi.fn(),
    useApplyToTemplate: vi.fn(),
    useSaveAsTemplate: vi.fn(),
    useDeleteWorkout: vi.fn(),
  };
});

const finished: Workout = {
  id: 9, name: "Giorno 1", template_id: 2, status: "finished",
  started_at: "2026-09-24T18:00:00Z", finished_at: "2026-09-24T19:05:00Z",
  rest_ends_at: null, rest_total_s: null, server_now: "2026-09-24T19:05:00Z",
  template_diff: ["Barbell Squat: serie 1 80 kg × 8 → 85 kg × 8"],
  exercises: [
    {
      id: 21, rest_seconds: 90, superset_group: null, note: null,
      exercise: {
        id: 7, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
        secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
      },
      sets: [{ id: 31, weight_kg: 85, reps: 8, duration_s: null, completed_at: "2026-09-24T18:10:00Z", previous: null }],
    },
  ],
};

const apply = vi.fn();
const saveAs = vi.fn();
const remove = vi.fn();

function mockWorkout(workout: Workout) {
  vi.mocked(useWorkout).mockReturnValue({ data: workout, isLoading: false, isError: false } as unknown as ReturnType<typeof useWorkout>);
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/gym/history/:id" element={<WorkoutDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkoutDetailPage", () => {
  beforeEach(() => {
    apply.mockReset();
    saveAs.mockReset();
    remove.mockReset();
    vi.mocked(useApplyToTemplate).mockReturnValue({ mutate: apply, isPending: false, isSuccess: false } as unknown as ReturnType<typeof useApplyToTemplate>);
    vi.mocked(useSaveAsTemplate).mockReturnValue({ mutate: saveAs, isPending: false, isSuccess: false } as unknown as ReturnType<typeof useSaveAsTemplate>);
    vi.mocked(useDeleteWorkout).mockReturnValue({ mutate: remove, isPending: false } as unknown as ReturnType<typeof useDeleteWorkout>);
  });

  it("offers to update the template in the summary", async () => {
    mockWorkout(finished);
    const user = userEvent.setup();
    renderAt("/gym/history/9?summary=1");

    expect(screen.getByText("Allenamento completato")).toBeInTheDocument();
    expect(screen.getByText("1 h 5 min")).toBeInTheDocument();
    expect(screen.getByText("85 kg × 8")).toBeInTheDocument();
    expect(screen.getByText("Barbell Squat: serie 1 80 kg × 8 → 85 kg × 8")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Aggiorna modello" }));
    expect(apply).toHaveBeenCalledWith(9);
  });

  it("hides the diff when the user keeps the template", async () => {
    mockWorkout(finished);
    const user = userEvent.setup();
    renderAt("/gym/history/9?summary=1");
    await user.click(screen.getByRole("button", { name: "Mantieni modello" }));
    expect(screen.queryByRole("button", { name: "Aggiorna modello" })).not.toBeInTheDocument();
  });

  it("does not show the diff outside the summary", () => {
    mockWorkout(finished);
    renderAt("/gym/history/9");
    expect(screen.queryByText("Modifiche rispetto al modello")).not.toBeInTheDocument();
  });

  it("offers to save a workout without template as a template", async () => {
    mockWorkout({ ...finished, template_id: null, template_diff: [] });
    vi.spyOn(window, "prompt").mockReturnValue("Nuovo modello");
    const user = userEvent.setup();
    renderAt("/gym/history/9?summary=1");
    await user.click(screen.getByRole("button", { name: "Salva come modello" }));
    expect(saveAs).toHaveBeenCalledWith({ workoutId: 9, name: "Nuovo modello" });
  });

  it("deletes a workout after confirmation and returns to history on success", async () => {
    mockWorkout(finished);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/gym/history/9"]}>
        <Routes>
          <Route path="/gym/history/:id" element={<WorkoutDetailPage />} />
          <Route path="/gym/history" element={<p>Storico destinazione</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Azioni allenamento" }));
    await user.click(screen.getByRole("menuitem", { name: "Elimina" }));

    expect(confirm).toHaveBeenCalledWith("Eliminare questo allenamento dallo storico?");
    expect(remove).toHaveBeenCalledWith(9, expect.objectContaining({ onSuccess: expect.any(Function) }));
    const options = remove.mock.calls[0]?.[1];
    await act(async () => options?.onSuccess?.(undefined, 9, undefined, undefined));
    expect(screen.getByText("Storico destinazione")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("does not delete a workout when confirmation is declined", async () => {
    mockWorkout(finished);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderAt("/gym/history/9");

    await user.click(screen.getByRole("button", { name: "Azioni allenamento" }));
    await user.click(screen.getByRole("menuitem", { name: "Elimina" }));

    expect(confirm).toHaveBeenCalledWith("Eliminare questo allenamento dallo storico?");
    expect(remove).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
