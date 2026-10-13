import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Exercise, useExercises } from "../../api/gym";
import ExerciseList from "./ExerciseList";

const squat: Exercise = {
  id: 1, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};
const curl: Exercise = { ...squat, id: 2, name: "Dumbbell Curl", equipment: "dumbbell", primary_muscles: ["biceps"] };

function renderList(query: Partial<ReturnType<typeof useExercises>>) {
  return render(
    <ExerciseList query={query as ReturnType<typeof useExercises>} onSelect={vi.fn()} />,
  );
}

describe("ExerciseList", () => {
  it("shows a loading message while the exercises load", () => {
    renderList({ isLoading: true });
    expect(screen.getByText("Caricamento...")).toBeInTheDocument();
  });

  it("shows an error message when the exercises fail", () => {
    renderList({ isError: true });
    expect(screen.getByText("Errore nel caricamento.")).toBeInTheDocument();
  });

  it("shows the empty message when there are no exercises", () => {
    renderList({ data: { items: [], total: 0 }, isLoading: false, isError: false });
    expect(screen.getByText("Nessun esercizio trovato.")).toBeInTheDocument();
  });

  it("lists every exercise by name", () => {
    renderList({ data: { items: [squat, curl], total: 2 }, isLoading: false, isError: false });
    expect(screen.getByText("Barbell Squat")).toBeInTheDocument();
    expect(screen.getByText("Dumbbell Curl")).toBeInTheDocument();
  });
});
