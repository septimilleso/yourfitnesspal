import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDayDiary, useDeleteEntry, useGoal, usePatchEntry, useWeekDiary } from "../api/queries";
import { useSavedWeek, useSavedWeeks, useDeleteSavedWeek, useRenameSavedWeek } from "../api/savedWeeks";
import { useHasPermission } from "../auth/AuthContext";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "../native/connectivity";
import { pausedQuery, retryingQuery } from "../test/offlineQuery";
import DayPage from "./DayPage";
import SavedWeekDetailPage from "./SavedWeekDetailPage";
import SavedWeeksPage from "./SavedWeeksPage";
import WeekPage from "./WeekPage";

vi.mock("../native/platform", () => ({ isNative: () => true }));
vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return {
    ...actual,
    useDayDiary: vi.fn(),
    useDeleteEntry: vi.fn(),
    usePatchEntry: vi.fn(),
    useWeekDiary: vi.fn(),
    useGoal: vi.fn(),
  };
});
vi.mock("../api/savedWeeks", () => ({
  useSavedWeeks: vi.fn(),
  useSavedWeek: vi.fn(),
  useApplySavedWeek: vi.fn(),
  useRenameSavedWeek: vi.fn(),
  useDeleteSavedWeek: vi.fn(),
}));
vi.mock("../auth/AuthContext", () => ({ useHasPermission: vi.fn(() => false) }));
vi.mock("../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));

function renderAt(path: string, route: string, element: ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

const pages = [
  {
    name: "DayPage",
    // Testi che non devono comparire: caricamento, errore ed elenco vuoto della pagina.
    forbidden: ["Caricamento...", "Errore nel caricamento del diario."],
    mockQuery: (query: object) => {
      vi.mocked(useDayDiary).mockReturnValue(query as unknown as ReturnType<typeof useDayDiary>);
    },
    renderPage: () => renderAt("/?date=2026-08-26", "/", <DayPage />),
  },
  {
    name: "WeekPage",
    forbidden: ["Caricamento...", "Errore nel caricamento della settimana."],
    mockQuery: (query: object) => {
      vi.mocked(useWeekDiary).mockReturnValue(query as unknown as ReturnType<typeof useWeekDiary>);
    },
    renderPage: () => renderAt("/week?start=2026-08-24", "/week", <WeekPage />),
  },
  {
    name: "SavedWeeksPage",
    forbidden: [
      "Caricamento...",
      "Errore nel caricamento delle settimane salvate.",
      "Nessuna settimana salvata.",
    ],
    mockQuery: (query: object) => {
      vi.mocked(useSavedWeeks).mockReturnValue(query as unknown as ReturnType<typeof useSavedWeeks>);
    },
    renderPage: () => renderAt("/week/saved", "/week/saved", <SavedWeeksPage />),
  },
  {
    name: "SavedWeekDetailPage",
    forbidden: ["Caricamento...", "Settimana non trovata."],
    mockQuery: (query: object) => {
      vi.mocked(useSavedWeek).mockReturnValue(query as unknown as ReturnType<typeof useSavedWeek>);
    },
    renderPage: () => renderAt("/week/saved/8", "/week/saved/:id", <SavedWeekDetailPage />),
  },
];

beforeEach(() => {
  reportNetworkFailure();
  vi.mocked(useDeleteEntry).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteEntry>);
  vi.mocked(usePatchEntry).mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof usePatchEntry>);
  vi.mocked(useGoal).mockReturnValue({ data: undefined, isLoading: false, isError: false } as unknown as ReturnType<typeof useGoal>);
  vi.mocked(useRenameSavedWeek).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useRenameSavedWeek>);
  vi.mocked(useDeleteSavedWeek).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useDeleteSavedWeek>);
  vi.mocked(useHasPermission).mockReturnValue(false);
});

afterEach(() => {
  resetConnectivityForTests();
});

describe.each(pages)("$name offline", ({ forbidden, mockQuery, renderPage }) => {
  it("con la query in pausa e senza dati mostra Non disponibile offline", () => {
    mockQuery(pausedQuery());

    renderPage();

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.getByText("Aprila con la rete per averla anche offline.")).toBeInTheDocument();
    for (const text of forbidden) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  it("con la query di nuovo in fetching resta Non disponibile offline e non compare Caricamento", () => {
    mockQuery(retryingQuery());

    renderPage();

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento...")).not.toBeInTheDocument();
  });

  it("con la rete presente il messaggio non compare", () => {
    reportNetworkSuccess();
    mockQuery(pausedQuery());

    renderPage();

    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
  });
});
