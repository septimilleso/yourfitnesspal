import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DiaryEntry } from "../api/queries";
import FoodRow from "./FoodRow";

const entry: DiaryEntry = {
  id: 3,
  food_id: 100,
  food_name: "Pasta integrale",
  food_brand: null,
  date: "2026-08-26",
  meal: "lunch",
  grams: 150,
  portion_label: null,
  position: 0,
  nutriments_snapshot: {
    kcal: 350,
    protein_g: 12,
    carbs_g: 70,
    sugars_g: 3,
    fat_g: 2,
    sat_fat_g: 0.5,
    fiber_g: 6,
    salt_g: 0.02,
  },
};

function renderRow(overrides: Partial<React.ComponentProps<typeof FoodRow>> = {}) {
  const onDelete = vi.fn();
  const onEdit = vi.fn();
  render(
    <ul>
      <FoodRow entry={entry} onDelete={onDelete} onEdit={onEdit} {...overrides} />
    </ul>,
  );
  return { onDelete, onEdit };
}

describe("FoodRow", () => {
  it("calls onEdit with the entry when the name area is tapped", async () => {
    const user = userEvent.setup();
    const { onEdit, onDelete } = renderRow();

    await user.click(screen.getByRole("button", { name: /modifica pasta integrale/i }));

    expect(onEdit).toHaveBeenCalledWith(entry);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("includes the grams in the edit button's accessible name", () => {
    renderRow();

    expect(
      screen.getByRole("button", { name: /modifica pasta integrale, 150 g/i }),
    ).toBeInTheDocument();
  });

  it("still calls onDelete with the entry id when the trash button is tapped", async () => {
    const user = userEvent.setup();
    const { onEdit, onDelete } = renderRow();

    await user.click(screen.getByRole("button", { name: /elimina pasta integrale/i }));

    expect(onDelete).toHaveBeenCalledWith(3);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("disables both buttons while deleting", () => {
    renderRow({ deleting: true });

    expect(screen.getByRole("button", { name: /modifica pasta integrale/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /elimina pasta integrale/i })).toBeDisabled();
  });
});
