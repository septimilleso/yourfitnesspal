import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WeightHistory } from "../api/weights";
import { useDeleteWeight, useWeightHistory } from "../api/weights";
import type { Goal, WeekDayTotal } from "../api/queries";
import { useDiaryRange, useGoal } from "../api/queries";
import { todayIso } from "../lib/date";
import DietStatsPage from "./DietStatsPage";

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return { ...actual, useDiaryRange: vi.fn(), useGoal: vi.fn() };
});
vi.mock("../api/weights", async () => {
  const actual = await vi.importActual<typeof import("../api/weights")>("../api/weights");
  return { ...actual, useWeightHistory: vi.fn(), useDeleteWeight: vi.fn() };
});
vi.mock("../lib/date", async () => {
  const actual = await vi.importActual<typeof import("../lib/date")>("../lib/date");
  return { ...actual, todayIso: vi.fn(() => "2026-09-25") };
});
vi.mock("../components/GoalForm", () => ({ default: () => <div data-testid="goal-form" /> }));
vi.mock("../components/StreakCard", () => ({ default: () => <div data-testid="streak-card" /> }));
vi.mock("../components/ModeSwitch", () => ({ default: () => null }));

const goal: Goal = { id: 1, kcal: 2000, protein_g: 150, carbs_g: 250, fat_g: 70, valid_from: "2026-01-01" };
const emptyWeights: WeightHistory = { start: "2026-09-19", end: "2026-09-25", days: [], weeks: [] };
const mutateWeight = vi.fn();

function weights(days: WeightHistory["days"]): WeightHistory {
  return { ...emptyWeights, days };
}

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
    vi.mocked(useWeightHistory).mockReturnValue({ data: emptyWeights, isLoading: false, isError: false } as ReturnType<typeof useWeightHistory>);
    mutateWeight.mockReset();
    vi.mocked(useDeleteWeight).mockReturnValue({ mutate: mutateWeight } as unknown as ReturnType<typeof useDeleteWeight>);
  });

  it("shows the weight chart and weigh-ins from newest to oldest", () => {
    vi.mocked(useWeightHistory).mockReturnValue({
      data: weights([
        { date: "2026-09-19", id: 1, weight_kg: 72.5, avg_7d_kg: 72.5 },
        { date: "2026-09-20", id: null, weight_kg: null, avg_7d_kg: 72.5 },
        { date: "2026-09-21", id: 2, weight_kg: 71.8, avg_7d_kg: 72.2 },
      ]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useWeightHistory>);

    renderAt();

    expect(screen.getByRole("heading", { name: "Peso" })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="weight-point"]')).toHaveLength(2);
    expect(document.querySelector('[data-testid="weight-avg-line"]')).toBeInTheDocument();
    const weightSection = screen.getByRole("heading", { name: "Peso" }).closest("section");
    const rows = within(weightSection!).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("lunedì 21 settembre"),
      expect.stringContaining("sabato 19 settembre"),
    ]);
    expect(rows[0]).toHaveTextContent("71,8 kg");
    expect(rows[1]).toHaveTextContent("72,5 kg");
    expect(useWeightHistory).toHaveBeenLastCalledWith("2026-09-19", "2026-09-25", true);
    const diaryPeriod = vi.mocked(useDiaryRange).mock.lastCall;
    expect(useWeightHistory).toHaveBeenLastCalledWith(diaryPeriod?.[0], diaryPeriod?.[1], true);
  });

  it("deletes a weigh-in after confirmation and does nothing when cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm");
    vi.mocked(useWeightHistory).mockReturnValue({
      data: weights([{ date: "2026-09-24", id: 42, weight_kg: 70.2, avg_7d_kg: 70.2 }]),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useWeightHistory>);
    const user = userEvent.setup();
    renderAt();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Elimina pesata del giovedì 24 settembre" }));
    expect(confirm).toHaveBeenCalledWith("Eliminare questa pesata?");
    expect(mutateWeight).toHaveBeenCalledWith(42);

    mutateWeight.mockClear();
    confirm.mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: "Elimina pesata del giovedì 24 settembre" }));
    expect(mutateWeight).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows an empty weight period", () => {
    renderAt();
    expect(screen.getByText("Nessuna pesata nel periodo")).toBeInTheDocument();
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
});
