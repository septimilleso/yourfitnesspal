import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Meal } from "../api/queries";
import { MEALS } from "../api/queries";
import CopyOptionsFields from "./CopyOptionsFields";

describe("CopyOptionsFields", () => {
  it("renders the date, all meals, and both mode descriptions", () => {
    render(
      <CopyOptionsFields
        targetStart="2026-09-01"
        onTargetStartChange={vi.fn()}
        selectedMeals={MEALS}
        onToggleMeal={vi.fn()}
        mode="append"
        onModeChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Data di inizio")).toHaveValue("2026-09-01");
    expect(screen.getByRole("group", { name: "Pasti" })).toBeInTheDocument();
    for (const label of ["Colazione", "Pranzo", "Cena", "Spuntino"]) {
      expect(screen.getByRole("checkbox", { name: label })).toBeChecked();
    }
    expect(screen.getByText("Mantiene i pasti già presenti")).toBeInTheDocument();
    expect(screen.getByText("Cancella i pasti già presenti")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Aggiungi/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Sostituisci/i })).not.toBeChecked();
  });

  it("calls the callbacks when date, meals, and mode change", async () => {
    const onTargetStartChange = vi.fn();
    const onToggleMeal = vi.fn<(meal: Meal) => void>();
    const onModeChange = vi.fn<(mode: "append" | "replace") => void>();
    const user = userEvent.setup();
    render(
      <CopyOptionsFields
        targetStart=""
        onTargetStartChange={onTargetStartChange}
        selectedMeals={MEALS}
        onToggleMeal={onToggleMeal}
        mode="append"
        onModeChange={onModeChange}
      />,
    );

    await user.type(screen.getByLabelText("Data di inizio"), "2026-09-01");
    await user.click(screen.getByRole("checkbox", { name: "Cena" }));
    await user.click(screen.getByRole("radio", { name: /Sostituisci/i }));

    expect(onTargetStartChange).toHaveBeenLastCalledWith("2026-09-01");
    expect(onToggleMeal).toHaveBeenCalledWith("dinner");
    expect(onModeChange).toHaveBeenCalledWith("replace");
  });
});
