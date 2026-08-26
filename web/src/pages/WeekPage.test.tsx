import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Goal, WeekResponse } from "../api/queries";
import { useGoal, useWeekDiary } from "../api/queries";
import WeekPage from "./WeekPage";

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return {
    ...actual,
    useWeekDiary: vi.fn(),
    useGoal: vi.fn(),
  };
});

function nutriments(kcal: number) {
  return {
    kcal,
    protein_g: 10,
    carbs_g: 20,
    sugars_g: 5,
    fat_g: 3,
    sat_fat_g: 1,
    fiber_g: 2,
    salt_g: 0.5,
  };
}

const weekResponse: WeekResponse = {
  start: "2026-08-24",
  end: "2026-08-30",
  days: [
    { date: "2026-08-24", total: nutriments(1800) },
    { date: "2026-08-25", total: nutriments(2200) },
    { date: "2026-08-26", total: nutriments(0) },
    { date: "2026-08-27", total: nutriments(0) },
    { date: "2026-08-28", total: nutriments(0) },
    { date: "2026-08-29", total: nutriments(0) },
    { date: "2026-08-30", total: nutriments(0) },
  ],
};

const goal: Goal = {
  id: 1,
  kcal: 2000,
  protein_g: 150,
  carbs_g: 250,
  fat_g: 70,
  valid_from: "2026-01-01",
};

function setupMocks(overrides: Partial<ReturnType<typeof useWeekDiary>> = {}) {
  vi.mocked(useWeekDiary).mockReturnValue({
    data: weekResponse,
    isLoading: false,
    isError: false,
    ...overrides,
  } as ReturnType<typeof useWeekDiary>);
  vi.mocked(useGoal).mockReturnValue({
    data: goal,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useGoal>);
}

function renderWeekPage(initialPath = "/week?start=2026-08-24") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/week" element={<WeekPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WeekPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a 7-day grid with kcal totals", () => {
    setupMocks();
    renderWeekPage();

    expect(screen.getByText("1800")).toBeInTheDocument();
    expect(screen.getByText("2200")).toBeInTheDocument();
  });

  it("colors macro totals against goal, not just kcal", () => {
    setupMocks();
    renderWeekPage();

    // Day 1 (2026-08-24): protein_g total is 10, goal protein_g is 150 -> under goal, green.
    const proteinUnderGoal = screen.getAllByText("10g")[0];
    expect(proteinUnderGoal).toHaveClass("text-green-600");

    // Day 2 (2026-08-25) also has protein_g 10, still under the 150 goal -> green as well.
    // To assert the "over goal" red case, render a day whose protein_g exceeds the goal.
    const overGoalWeekResponse: WeekResponse = {
      ...weekResponse,
      days: [
        { date: "2026-08-24", total: { ...nutriments(1800), protein_g: 200 } },
        ...weekResponse.days.slice(1),
      ],
    };
    vi.mocked(useWeekDiary).mockReturnValue({
      data: overGoalWeekResponse,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useWeekDiary>);

    renderWeekPage();

    const proteinOverGoal = screen.getAllByText("200g")[0];
    expect(proteinOverGoal).toHaveClass("text-red-600");
  });

  it("shows no action bar when no day is selected", () => {
    setupMocks();
    renderWeekPage();

    expect(screen.queryByRole("button", { name: /copia \d+ giorni/i })).not.toBeInTheDocument();
  });

  it("enables the action bar with the count when 2 day checkboxes are selected", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderWeekPage();

    await user.click(screen.getByLabelText("Seleziona 2026-08-24"));
    await user.click(screen.getByLabelText("Seleziona 2026-08-25"));

    expect(screen.getByRole("button", { name: /copia 2 giorni/i })).toBeInTheDocument();
  });

  it("opens the copy dialog from the action bar with the selected source dates", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderWeekPage();

    await user.click(screen.getByLabelText("Seleziona 2026-08-24"));
    await user.click(screen.getByLabelText("Seleziona 2026-08-25"));
    await user.click(screen.getByRole("button", { name: /copia 2 giorni/i }));

    expect(screen.getByRole("dialog", { name: /copia giorni/i })).toBeInTheDocument();
  });

  it("opens the copy dialog for a single day from its ⋯ menu", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderWeekPage();

    await user.click(screen.getByLabelText("Altre azioni 2026-08-24"));

    expect(screen.getByRole("dialog", { name: /copia giorni/i })).toBeInTheDocument();
  });

  it("positions the action bar above the bottom nav bar, not overlapping it", async () => {
    // Regression test: AppShell's bottom nav (`fixed inset-x-0 bottom-0`,
    // NavLink items with `min-h-[44px]`, so the nav's rendered height is
    // exactly 44px = Tailwind's `bottom-11` (2.75rem)) is a fixed sibling
    // rendered after this page's own action bar. If the action bar also
    // sits at `bottom-0`, the later-painted nav covers it and the
    // "Copia N giorni..." button becomes unclickable. It must sit exactly
    // one nav-height above the bottom edge, and above the nav in stacking
    // order, so a future refactor can't silently reintroduce the overlap.
    setupMocks();
    const user = userEvent.setup();
    renderWeekPage();

    await user.click(screen.getByLabelText("Seleziona 2026-08-24"));

    const actionBar = screen.getByRole("button", { name: /copia 1 giorno/i }).parentElement;
    expect(actionBar).not.toBeNull();
    expect(actionBar).toHaveClass("bottom-11");
    expect(actionBar).not.toHaveClass("bottom-0");

    // Must also declare a z-index above the nav bar's (z-10, see
    // AppShell.tsx) as defense-in-depth against the offset alone drifting
    // out of sync with the nav's actual height again.
    expect(actionBar).toHaveClass("z-20");
  });
});
