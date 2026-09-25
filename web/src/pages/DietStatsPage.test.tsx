import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Goal, WeekDayTotal } from "../api/queries";
import { useDiaryRange, useGoal } from "../api/queries";
import { todayIso } from "../lib/date";
import DietStatsPage from "./DietStatsPage";

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return { ...actual, useDiaryRange: vi.fn(), useGoal: vi.fn() };
});
vi.mock("../lib/date", async () => {
  const actual = await vi.importActual<typeof import("../lib/date")>("../lib/date");
  return { ...actual, todayIso: vi.fn(() => "2026-09-25") };
});
vi.mock("../components/GoalForm", () => ({ default: () => <div data-testid="goal-form" /> }));
vi.mock("../components/StreakCard", () => ({ default: () => <div data-testid="streak-card" /> }));
vi.mock("../components/ModeSwitch", () => ({ default: () => null }));

const goal: Goal = { id: 1, kcal: 2000, protein_g: 150, carbs_g: 250, fat_g: 70, valid_from: "2026-01-01" };

function day(date: string, kcal: number): WeekDayTotal {
  return {
    date,
    total: { kcal, protein_g: 100, carbs_g: 200, sugars_g: 0, fat_g: 60, sat_fat_g: 0, fiber_g: 0, salt_g: 0 },
  } as WeekDayTotal;
}

function mockRange(days: WeekDayTotal[]) {
  vi.mocked(useDiaryRange).mockReturnValue({
    data: { start: days[0]?.date ?? "", end: days.at(-1)?.date ?? "", days },
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useDiaryRange>);
}

function renderAt(path = "/stats") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DietStatsPage />
    </MemoryRouter>,
  );
}

describe("DietStatsPage", () => {
  beforeEach(() => {
    vi.mocked(todayIso).mockReturnValue("2026-09-25");
    vi.mocked(useGoal).mockReturnValue({ data: goal } as ReturnType<typeof useGoal>);
    mockRange([day("2026-09-24", 1800), day("2026-09-25", 2200)]);
  });

  it("renders streak, goals, charts and summary for the last 7 days by default", () => {
    renderAt();
    expect(screen.getByTestId("streak-card")).toBeInTheDocument();
    expect(screen.getByTestId("goal-form")).toBeInTheDocument();
    expect(useDiaryRange).toHaveBeenLastCalledWith("2026-09-19", "2026-09-25", true);
    expect(screen.getByRole("button", { name: "7 giorni" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Medie del periodo")).toBeInTheDocument();
    expect(screen.getByText("2000 kcal")).toBeInTheDocument();
  });

  it("switches preset", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole("button", { name: "30 giorni" }));
    expect(useDiaryRange).toHaveBeenLastCalledWith("2026-08-27", "2026-09-25", true);
  });

  it("uses a valid custom range from the URL", () => {
    renderAt("/stats?from=2026-09-01&to=2026-09-10");
    expect(screen.getByRole("button", { name: "Personalizzato" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Dal")).toHaveValue("2026-09-01");
    expect(useDiaryRange).toHaveBeenLastCalledWith("2026-09-01", "2026-09-10", true);
  });

  it("blocks the request for an invalid custom range", () => {
    renderAt("/stats?from=2026-09-10&to=2026-09-01");
    expect(screen.getByRole("alert")).toHaveTextContent("La data iniziale deve precedere quella finale.");
    expect(vi.mocked(useDiaryRange).mock.lastCall?.[2]).toBe(false);
    expect(screen.queryByText("Medie del periodo")).not.toBeInTheDocument();
  });

  it("opens the custom range on the current period", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole("button", { name: "Personalizzato" }));
    expect(screen.getByLabelText("Dal")).toHaveValue("2026-09-19");
    expect(screen.getByLabelText("Al")).toHaveValue("2026-09-25");
  });

  it("shows no goal line or target when logged days have no goal", () => {
    vi.mocked(useGoal).mockReturnValue({ data: null } as unknown as ReturnType<typeof useGoal>);
    mockRange([day("2026-09-24", 1800), day("2026-09-25", 2200)]);
    renderAt();
    expect(screen.queryByTestId("goal-line")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Obiettivo" })).not.toBeInTheDocument();
    expect(screen.getByText("Giorni sopra obiettivo").nextElementSibling).toHaveTextContent("–");
  });

  it("shows the empty state when there are no logged days", () => {
    mockRange([day("2026-09-25", 0)]);
    renderAt();
    expect(screen.getAllByText("Nessun dato nel periodo").length).toBeGreaterThan(0);
  });

  it("shows an error when the range fails to load", () => {
    vi.mocked(useDiaryRange).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as unknown as ReturnType<typeof useDiaryRange>);
    renderAt();
    expect(screen.getByText("Impossibile caricare le statistiche.")).toBeInTheDocument();
  });

  it("leaves room at the bottom to see the cat", () => {
    const { container } = renderAt();
    expect(container.querySelector('[data-testid="cat-spacer"]')).toHaveClass("h-[55vh]");
  });
});
