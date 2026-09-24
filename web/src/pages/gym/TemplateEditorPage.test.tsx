import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../../api/gym";
import { useCreateTemplate, useReplaceTemplate, useTemplate, useTemplates } from "../../api/gym";
import TemplateEditorPage from "./TemplateEditorPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useTemplate: vi.fn(),
    useTemplates: vi.fn(),
    useCreateTemplate: vi.fn(),
    useReplaceTemplate: vi.fn(),
  };
});

const squat: Exercise = {
  id: 7, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};

vi.mock("../../components/gym/ExercisePicker", () => ({
  default: ({ onPick }: { onPick: (list: Exercise[]) => void }) => (
    <button type="button" onClick={() => onPick([squat])}>
      pick squat
    </button>
  ),
}));

const create = vi.fn();

describe("TemplateEditorPage", () => {
  beforeEach(() => {
    create.mockReset();
    vi.mocked(useTemplate).mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useTemplate>);
    vi.mocked(useTemplates).mockReturnValue({
      data: { folders: [{ id: 3, name: "Settimana 1", position: 0 }], templates: [] },
    } as unknown as ReturnType<typeof useTemplates>);
    vi.mocked(useCreateTemplate).mockReturnValue({ mutate: create, isPending: false, isError: false } as unknown as ReturnType<typeof useCreateTemplate>);
    vi.mocked(useReplaceTemplate).mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false } as unknown as ReturnType<typeof useReplaceTemplate>);
  });

  it("builds a new template", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/gym/templates/new"]}>
        <Routes>
          <Route path="/gym/templates/new" element={<TemplateEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Nome del modello"), "Giorno 1");
    await user.selectOptions(screen.getByLabelText("Cartella"), "3");
    await user.click(screen.getByRole("button", { name: "+ Aggiungi esercizio" }));
    await user.click(screen.getByRole("button", { name: "pick squat" }));
    await user.type(screen.getByLabelText("kg serie 1"), "80");
    await user.type(screen.getByLabelText("Rip. serie 1"), "8");
    await user.click(screen.getByRole("button", { name: "+ Aggiungi serie" }));
    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(create).toHaveBeenCalledWith(
      {
        name: "Giorno 1",
        folder_id: 3,
        exercises: [
          {
            exercise_id: 7,
            rest_seconds: 90,
            superset_group: null,
            note: null,
            sets: [
              { weight_kg: 80, reps: 8, duration_s: null },
              { weight_kg: 80, reps: 8, duration_s: null },
            ],
          },
        ],
      },
      expect.anything(),
    );
  });
});
