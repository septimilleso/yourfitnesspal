import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../../api/gym";
import { useExercises } from "../../api/gym";
import ExercisePicker from "./ExercisePicker";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useExercises: vi.fn() };
});

vi.mock("./CustomExerciseForm", () => ({ default: () => <div data-testid="custom-form" /> }));

const squat: Exercise = {
  id: 1, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};
const curl: Exercise = { ...squat, id: 2, name: "Dumbbell Curl", equipment: "dumbbell", primary_muscles: ["biceps"] };

describe("ExercisePicker", () => {
  beforeEach(() => {
    vi.mocked(useExercises).mockReturnValue({
      data: { items: [squat, curl], total: 2 }, isLoading: false, isError: false,
    } as unknown as ReturnType<typeof useExercises>);
  });

  it("returns every selected exercise in multiple mode", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ExercisePicker onPick={onPick} onClose={vi.fn()} />);

    expect(screen.getByText("Bilanciere · Quadricipiti")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Barbell Squat/ }));
    await user.click(screen.getByRole("button", { name: /Dumbbell Curl/ }));
    await user.click(screen.getByRole("button", { name: "Aggiungi (2)" }));

    expect(onPick).toHaveBeenCalledWith([squat, curl]);
  });

  it("returns right away in single mode", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ExercisePicker multiple={false} onPick={onPick} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Dumbbell Curl/ }));

    expect(onPick).toHaveBeenCalledWith([curl]);
  });

  it("opens the custom exercise form", async () => {
    const user = userEvent.setup();
    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "+ Nuovo" }));
    expect(screen.getByTestId("custom-form")).toBeInTheDocument();
  });
});
