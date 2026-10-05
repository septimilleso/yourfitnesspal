import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useApplySavedWeek,
  useDeleteSavedWeek,
  useRenameSavedWeek,
  useSavedWeek,
} from "../api/savedWeeks";
import SavedWeekDetailPage from "./SavedWeekDetailPage";

vi.mock("../api/savedWeeks", () => ({
  useSavedWeek: vi.fn(),
  useApplySavedWeek: vi.fn(),
  useRenameSavedWeek: vi.fn(),
  useDeleteSavedWeek: vi.fn(),
}));
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

const mutate = vi.fn();
const renameMutate = vi.fn();
const deleteMutate = vi.fn((id: number, options?: { onSuccess?: () => void }) => {
  void id;
  options?.onSuccess?.();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/week/saved/8"]}>
      <Routes>
        <Route path="/week/saved/:id" element={<SavedWeekDetailPage />} />
        <Route path="/week/saved" element={<h1>Settimane salvate</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SavedWeekDetailPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mutate.mockClear();
    renameMutate.mockClear();
    deleteMutate.mockClear();
    vi.mocked(useSavedWeek).mockReturnValue({ data: week, isLoading: false, isError: false } as unknown as ReturnType<typeof useSavedWeek>);
    vi.mocked(useApplySavedWeek).mockReturnValue({
      mutate,
      isPending: false,
      isSuccess: false,
      isError: false,
      data: undefined,
      reset: vi.fn(),
    } as unknown as ReturnType<typeof useApplySavedWeek>);
    vi.mocked(useRenameSavedWeek).mockReturnValue({ mutate: renameMutate } as unknown as ReturnType<typeof useRenameSavedWeek>);
    vi.mocked(useDeleteSavedWeek).mockReturnValue({ mutate: deleteMutate } as unknown as ReturnType<typeof useDeleteSavedWeek>);
  });

  it("shows all seven days, totals, and foods grouped by meal", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Dieta A" })).toBeInTheDocument();
    expect(vi.mocked(useSavedWeek)).toHaveBeenCalledWith(8);
    for (const label of ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    const monday = screen.getByRole("region", { name: "Lun" });
    expect(within(monday).getByText("123")).toBeInTheDocument();
    expect(within(monday).getByText("21g")).toBeInTheDocument();
    expect(within(monday).getByText("33g")).toBeInTheDocument();
    expect(within(monday).getByText("9g")).toBeInTheDocument();
    expect(within(monday).getByText("Colazione")).toBeInTheDocument();
    expect(within(monday).getByText("Avena — 45 g (1 ciotola)")).toBeInTheDocument();

    const tuesday = screen.getByRole("region", { name: "Mar" });
    expect(within(tuesday).getByText("Nessun pasto")).toBeInTheDocument();
  });

  it("shows a not-found message when the request fails", () => {
    vi.mocked(useSavedWeek).mockReturnValue({ data: undefined, isLoading: false, isError: true } as ReturnType<typeof useSavedWeek>);
    renderPage();

    expect(screen.getByText("Settimana non trovata.")).toBeInTheDocument();
  });

  it("opens the apply dialog for the whole week", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Applica settimana…" }));

    expect(screen.getByRole("dialog", { name: "Applica settimana" })).toBeInTheDocument();
  });

  it("applies selected days in weekday order from the fixed action bar", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByText(/Applica \d+ giorni/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Seleziona Mar" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleziona Gio" }));

    const applyButton = screen.getByRole("button", { name: "Applica 2 giorni…" });
    const actionBar = applyButton.parentElement;
    expect(actionBar).toHaveClass("bottom-[var(--nav-height)]", "z-40");
    expect(actionBar).not.toHaveClass("bottom-0");
    await user.click(applyButton);
    expect(screen.getByRole("dialog", { name: "Applica settimana" })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/data di inizio/i), "2026-10-12");
    await user.click(screen.getByRole("button", { name: /^applica$/i }));

    expect(mutate).toHaveBeenCalledWith({
      id: 8,
      days: [1, 3],
      target_start: "2026-10-12",
      meals: null,
      mode: "append",
    });
  });

  it("shows a singular action when one day is selected", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("checkbox", { name: "Seleziona Mar" }));

    expect(screen.getByRole("button", { name: "Applica 1 giorno…" })).toBeInTheDocument();
  });

  it("clears the selected days when the apply dialog closes", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("checkbox", { name: "Seleziona Mar" }));
    await user.click(screen.getByRole("button", { name: "Applica 1 giorno…" }));
    await user.click(screen.getByRole("button", { name: "Annulla" }));

    expect(screen.queryByRole("button", { name: /Applica \d+ giorn[oi]/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Seleziona Mar" })).not.toBeChecked();
  });

  it("renames the saved week using the prompted name", async () => {
    const user = userEvent.setup();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("  Dieta B  ");
    renderPage();

    await user.click(screen.getByRole("button", { name: "Azioni settimana" }));
    await user.click(screen.getByRole("menuitem", { name: "Rinomina" }));

    expect(prompt).toHaveBeenCalledWith("Nome della settimana", "Dieta A");
    expect(renameMutate).toHaveBeenCalledWith({ id: 8, name: "Dieta B" });
  });

  it("does not rename when the prompt is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "prompt").mockReturnValue(null);
    renderPage();

    await user.click(screen.getByRole("button", { name: "Azioni settimana" }));
    await user.click(screen.getByRole("menuitem", { name: "Rinomina" }));

    expect(renameMutate).not.toHaveBeenCalled();
  });

  it("deletes the week after confirmation and navigates to the saved weeks", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    await user.click(screen.getByRole("button", { name: "Azioni settimana" }));
    await user.click(screen.getByRole("menuitem", { name: "Elimina" }));

    expect(confirm).toHaveBeenCalledWith("Eliminare questa settimana salvata?");
    expect(deleteMutate).toHaveBeenCalledWith(8, expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(screen.getByRole("heading", { name: "Settimane salvate" })).toBeInTheDocument();
  });

  it("does not delete when confirmation is denied", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();

    await user.click(screen.getByRole("button", { name: "Azioni settimana" }));
    await user.click(screen.getByRole("menuitem", { name: "Elimina" }));

    expect(deleteMutate).not.toHaveBeenCalled();
  });
});
