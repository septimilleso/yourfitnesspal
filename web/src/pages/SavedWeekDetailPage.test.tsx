import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSavedWeek } from "../api/savedWeeks";
import SavedWeekDetailPage from "./SavedWeekDetailPage";

vi.mock("../api/savedWeeks", () => ({ useSavedWeek: vi.fn() }));
vi.mock("../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));

const nutriments = {
  kcal: 123.4,
  protein_g: 21.2,
  carbs_g: 32.6,
  sugars_g: 4,
  fat_g: 8.8,
  sat_fat_g: 2,
  fiber_g: 3,
  salt_g: 0.4,
};

const week = {
  id: 8,
  name: "Dieta A",
  created_at: "2026-10-05T10:00:00Z",
  entries_count: 1,
  avg_kcal: 123.4,
  days: Array.from({ length: 7 }, (_, day_index) => ({
    day_index,
    meals: {
      breakfast: day_index === 0
        ? [{ id: 11, food_id: 2, food_name: "Avena", food_brand: null, grams: 45, portion_label: "1 ciotola", position: 0 }]
        : [],
      lunch: [],
      dinner: [],
      snack: [],
    },
    total: day_index === 0 ? nutriments : {
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      sugars_g: 0,
      fat_g: 0,
      sat_fat_g: 0,
      fiber_g: 0,
      salt_g: 0,
    },
  })),
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/week/saved/8"]}>
      <Routes>
        <Route path="/week/saved/:id" element={<SavedWeekDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SavedWeekDetailPage", () => {
  beforeEach(() => {
    vi.mocked(useSavedWeek).mockReturnValue({ data: week, isLoading: false, isError: false } as unknown as ReturnType<typeof useSavedWeek>);
  });

  it("shows all seven days, totals, and foods grouped by meal", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Dieta A" })).toBeInTheDocument();
    expect(vi.mocked(useSavedWeek)).toHaveBeenCalledWith(8);
    for (const label of ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    const monday = screen.getByLabelText("Lun");
    expect(within(monday).getByText("123")).toBeInTheDocument();
    expect(within(monday).getByText("21g")).toBeInTheDocument();
    expect(within(monday).getByText("33g")).toBeInTheDocument();
    expect(within(monday).getByText("9g")).toBeInTheDocument();
    expect(within(monday).getByText("Colazione")).toBeInTheDocument();
    expect(within(monday).getByText("Avena — 45 g (1 ciotola)")).toBeInTheDocument();

    const tuesday = screen.getByLabelText("Mar");
    expect(within(tuesday).getByText("Nessun pasto")).toBeInTheDocument();
  });

  it("shows a not-found message when the request fails", () => {
    vi.mocked(useSavedWeek).mockReturnValue({ data: undefined, isLoading: false, isError: true } as ReturnType<typeof useSavedWeek>);
    renderPage();

    expect(screen.getByText("Settimana non trovata.")).toBeInTheDocument();
  });
});
