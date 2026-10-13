import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useExerciseProgress,
  usePerformedExercises,
  type ExerciseProgress,
  type PerformedExercise,
} from "../../api/gym";
import ExerciseProgressSection from "./ExerciseProgressSection";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, usePerformedExercises: vi.fn(), useExerciseProgress: vi.fn() };
});

const period = { start: "2026-09-19", end: "2026-09-25" };

const exercises: PerformedExercise[] = [
  { exercise_id: 2, name: "Panca", tracking: "weight_reps", custom: false, last_date: "2026-09-20" },
];

const progress: ExerciseProgress = {
  exercise_id: 2,
  name: "Panca",
  tracking: "weight_reps",
  start: period.start,
  end: period.end,
  sessions: [],
  records: [],
};

function mockExercises(value: Partial<ReturnType<typeof usePerformedExercises>>) {
  vi.mocked(usePerformedExercises).mockReturnValue({ isLoading: false, isError: false, ...value } as ReturnType<typeof usePerformedExercises>);
}

function mockProgress(value: Partial<ReturnType<typeof useExerciseProgress>>) {
  vi.mocked(useExerciseProgress).mockReturnValue({ isLoading: false, isError: false, ...value } as ReturnType<typeof useExerciseProgress>);
}

function renderSection() {
  return render(
    <MemoryRouter>
      <ExerciseProgressSection period={period} enabled />
    </MemoryRouter>,
  );
}

describe("ExerciseProgressSection", () => {
  beforeEach(() => {
    mockExercises({ data: exercises });
    mockProgress({ data: progress });
  });

  it("shows a loading message while the exercises load without data", () => {
    mockExercises({ isLoading: true });
    renderSection();
    expect(screen.getByText("Caricamento esercizi...")).toBeInTheDocument();
  });

  it("shows an error message when the exercises fail", () => {
    mockExercises({ isError: true });
    renderSection();
    expect(screen.getByText("Impossibile caricare gli esercizi.")).toBeInTheDocument();
  });

  it("shows the empty message when the user has no performed exercises", () => {
    mockExercises({ data: [] });
    renderSection();
    expect(screen.getByText("Completa un allenamento per vedere i progressi")).toBeInTheDocument();
  });

  it("shows a loading message while the progress loads", () => {
    mockProgress({ isLoading: true });
    renderSection();
    expect(screen.getByText("Caricamento progressione...")).toBeInTheDocument();
  });
});
