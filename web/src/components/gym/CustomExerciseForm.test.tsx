import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useCreateExercise, useUpdateExercise } from "../../api/gym";
import CustomExerciseForm from "./CustomExerciseForm";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useCreateExercise: vi.fn(), useUpdateExercise: vi.fn() };
});

describe("CustomExerciseForm", () => {
  it("creates an exercise with the chosen fields", async () => {
    const mutate = vi.fn();
    vi.mocked(useCreateExercise).mockReturnValue({ mutate, isPending: false, isError: false } as unknown as ReturnType<typeof useCreateExercise>);
    vi.mocked(useUpdateExercise).mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useUpdateExercise>);
    const user = userEvent.setup();
    render(<CustomExerciseForm onClose={vi.fn()} onSaved={vi.fn()} />);

    const save = screen.getByRole("button", { name: "Salva" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Nome"), "Landmine Press");
    await user.selectOptions(screen.getByLabelText("Attrezzo"), "barbell");
    await user.selectOptions(screen.getByLabelText("Muscolo principale"), "shoulders");
    await user.click(screen.getByRole("radio", { name: "Solo ripetizioni" }));
    await user.click(save);

    expect(mutate).toHaveBeenCalledWith(
      { name: "Landmine Press", equipment: "barbell", primary_muscle: "shoulders", tracking: "reps" },
      expect.anything(),
    );
  });
});
