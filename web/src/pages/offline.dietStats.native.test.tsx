import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WeekDayTotal } from "../api/queries";
import { useDiaryRange, useGoal, useStreak } from "../api/queries";
import type { WeightHistory } from "../api/weights";
import { useDeleteWeight, useWeightHistory } from "../api/weights";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "../native/connectivity";
import { pausedQuery, retryingQuery } from "../test/offlineQuery";
import DietStatsPage from "./DietStatsPage";

vi.mock("../native/platform", () => ({ isNative: () => true }));
vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return { ...actual, useDiaryRange: vi.fn(), useGoal: vi.fn(), useStreak: vi.fn() };
});
vi.mock("../api/weights", async () => {
  const actual = await vi.importActual<typeof import("../api/weights")>("../api/weights");
  return { ...actual, useWeightHistory: vi.fn(), useDeleteWeight: vi.fn() };
});
vi.mock("../components/GoalForm", () => ({ default: () => <div data-testid="goal-form" /> }));
vi.mock("../components/ModeSwitch", () => ({ default: () => null }));

const emptyWeights: WeightHistory = { start: "2026-09-19", end: "2026-09-25", days: [], weeks: [] };

const loadedRange = {
  data: {
    start: "2026-09-19",
    end: "2026-09-25",
    days: [
      {
        date: "2026-09-25",
        total: { kcal: 2200, protein_g: 100, carbs_g: 200, sugars_g: 0, fat_g: 60, sat_fat_g: 0, fiber_g: 0, salt_g: 0 },
      } as WeekDayTotal,
    ],
  },
  isLoading: false,
  isError: false,
  fetchStatus: "idle",
};
const loadedStreak = { data: { current: 5, best: 5 }, isLoading: false, isError: false, fetchStatus: "idle" };
const loadedWeight = { data: emptyWeights, isLoading: false, isError: false, fetchStatus: "idle" };

function mockSections(sections: { range: object; streak: object; weight: object }) {
  vi.mocked(useDiaryRange).mockReturnValue(sections.range as unknown as ReturnType<typeof useDiaryRange>);
  vi.mocked(useStreak).mockReturnValue(sections.streak as unknown as ReturnType<typeof useStreak>);
  vi.mocked(useWeightHistory).mockReturnValue(sections.weight as unknown as ReturnType<typeof useWeightHistory>);
}

function renderAt(path = "/stats") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DietStatsPage />
    </MemoryRouter>,
  );
}

function streakSection() {
  return screen.getByText("🔥").closest("section")!;
}

function weightSection() {
  return screen.getByRole("heading", { name: "Peso" }).closest("section")!;
}

beforeEach(() => {
  reportNetworkFailure();
  vi.mocked(useGoal).mockReturnValue({ data: undefined, isLoading: false, isError: false } as unknown as ReturnType<typeof useGoal>);
  vi.mocked(useDeleteWeight).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useDeleteWeight>);
});

afterEach(() => {
  resetConnectivityForTests();
});

describe("DietStatsPage offline", () => {
  it("ogni sezione con la query in pausa mostra il proprio messaggio, senza caricamento né elenco vuoto", () => {
    mockSections({ range: pausedQuery(), streak: pausedQuery(), weight: pausedQuery() });

    renderAt();

    expect(screen.getAllByText("Non disponibile offline")).toHaveLength(3);
    expect(within(streakSection()).getByText("Non disponibile offline")).toBeInTheDocument();
    expect(within(weightSection()).getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento...")).not.toBeInTheDocument();
    expect(screen.queryByText("Nessuna pesata nel periodo")).not.toBeInTheDocument();
    expect(screen.queryByText("Nessun dato nel periodo")).not.toBeInTheDocument();
    expect(screen.queryByText("Impossibile caricare le statistiche.")).not.toBeInTheDocument();
    expect(screen.queryByText("Medie del periodo")).not.toBeInTheDocument();
  });

  it("C11: con il diario in cache e la serie in pausa i grafici restano e il messaggio compare solo nella card della serie", () => {
    mockSections({ range: loadedRange, streak: pausedQuery(), weight: loadedWeight });

    renderAt();

    expect(screen.getByText("Medie del periodo")).toBeInTheDocument();
    expect(screen.getAllByText("Non disponibile offline")).toHaveLength(1);
    expect(within(streakSection()).getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento...")).not.toBeInTheDocument();
  });

  it("con la query di nuovo in fetching il messaggio resta e Caricamento non compare", () => {
    mockSections({ range: retryingQuery(), streak: retryingQuery(), weight: retryingQuery() });

    renderAt();

    expect(screen.getAllByText("Non disponibile offline")).toHaveLength(3);
    expect(screen.queryByText("Caricamento...")).not.toBeInTheDocument();
  });

  it("con la rete presente e la query in fetching mostra Caricamento in ogni sezione", () => {
    reportNetworkSuccess();
    mockSections({ range: retryingQuery(), streak: retryingQuery(), weight: retryingQuery() });

    renderAt();

    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
    expect(screen.getAllByText("Caricamento...")).toHaveLength(3);
  });

  it("con la rete presente e la query in pausa il messaggio non compare", () => {
    reportNetworkSuccess();
    mockSections({ range: pausedQuery(), streak: pausedQuery(), weight: pausedQuery() });

    renderAt();

    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
  });

  it("con il messaggio visibile restano header, selettore periodo, form obiettivo e sezioni con dati", () => {
    mockSections({ range: pausedQuery(), streak: loadedStreak, weight: loadedWeight });

    renderAt();

    expect(screen.getByRole("heading", { name: "Statistiche" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 giorni" })).toBeInTheDocument();
    expect(screen.getByTestId("goal-form")).toBeInTheDocument();
    expect(screen.getByText("5 giorni di fila")).toBeInTheDocument();
    expect(screen.getByText("Nessuna pesata nel periodo")).toBeInTheDocument();
    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
  });
});
