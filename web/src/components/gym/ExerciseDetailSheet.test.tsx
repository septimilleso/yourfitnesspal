import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useArchiveExercise, useExercise, type ExerciseDetail } from "../../api/gym";
import ExerciseDetailSheet from "./ExerciseDetailSheet";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useExercise: vi.fn(), useArchiveExercise: vi.fn() };
});

const detail: ExerciseDetail = {
  id: 1,
  name: "Barbell Squat",
  equipment: "barbell",
  primary_muscles: ["quadriceps"],
  secondary_muscles: [],
  category: "strength",
  tracking: "weight_reps",
  custom: false,
  instructions: [],
};

function mockExercise(value: Partial<ReturnType<typeof useExercise>>) {
  vi.mocked(useExercise).mockReturnValue({ isLoading: false, isError: false, ...value } as ReturnType<typeof useExercise>);
}

function renderSheet() {
  return render(<ExerciseDetailSheet exerciseId={1} onClose={vi.fn()} />);
}

describe("ExerciseDetailSheet", () => {
  beforeEach(() => {
    vi.mocked(useArchiveExercise).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useArchiveExercise>);
    mockExercise({ data: detail });
  });

  it("shows a loading message while the exercise loads", () => {
    mockExercise({ isLoading: true });
    renderSheet();
    expect(screen.getByText("Caricamento...")).toBeInTheDocument();
  });

  it("shows an error message when the exercise fails", () => {
    mockExercise({ isError: true });
    renderSheet();
    expect(screen.getByText("Errore nel caricamento.")).toBeInTheDocument();
  });

  it("shows the exercise details", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "Barbell Squat" })).toBeInTheDocument();
    expect(screen.getByText("Attrezzo")).toBeInTheDocument();
  });
});
