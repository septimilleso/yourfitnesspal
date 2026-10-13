import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../api/gym";
import { useApplyToTemplate, useDeleteWorkout, useSaveAsTemplate, useWorkout } from "../api/gym";
import { useHasPermission, useMe } from "../auth/AuthContext";
import { createQueryClient } from "../lib/queryClient";
import { reportNetworkFailure, resetConnectivityForTests } from "../native/connectivity";
import SearchPage from "../pages/SearchPage";
import SettingsPage from "../pages/SettingsPage";
import WorkoutDetailPage from "../pages/gym/WorkoutDetailPage";
import ModeSwitch from "./ModeSwitch";

vi.mock("../native/platform", () => ({ isNative: () => true }));

// Le richieste di Cerca restano in sospeso: nessun dato, quindi il puntino legge solo la query osservata dal test.
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    client: { ...actual.client, get: vi.fn(() => new Promise(() => undefined)) },
  };
});

vi.mock("../components/Scanner", () => ({ default: () => null }));

vi.mock("../auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../auth/AuthContext")>("../auth/AuthContext");
  return { ...actual, useMe: vi.fn(), useHasPermission: vi.fn(() => false) };
});

vi.mock("../api/weights", () => ({
  useTodayWeight: () => ({ data: null }),
  useSaveWeight: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../api/gym")>("../api/gym");
  return {
    ...actual,
    useWorkout: vi.fn(),
    useApplyToTemplate: vi.fn(),
    useSaveAsTemplate: vi.fn(),
    useDeleteWorkout: vi.fn(),
  };
});

const finished = {
  id: 9, name: "Giorno 1", template_id: null, status: "finished",
  started_at: "2026-09-24T18:00:00Z", finished_at: "2026-09-24T19:05:00Z",
  rest_ends_at: null, rest_total_s: null, server_now: "2026-09-24T19:05:00Z",
  template_diff: [], exercises: [],
} as unknown as Workout;

let queryClient: QueryClient;

// Osservatore di una query con dati: l'indicatore usa le query in vista che hanno dati.
function DataObserver() {
  useQuery({ queryKey: ["diary"], queryFn: () => new Promise<string>(() => undefined), enabled: false });
  return null;
}

// Ora di oggi alle 14:05, così il testo è "Offline, dati delle 14:05".
function updatedAtToday(hour: number, minute: number): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).getTime();
}

function renderIn(path: string, ui: ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <DataObserver />
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const indicatorName = /Offline, dati delle 14:05/;

beforeEach(() => {
  queryClient = createQueryClient(true);
  queryClient.mount();
  queryClient.setQueryData(["diary"], "vecchi", { updatedAt: updatedAtToday(14, 5) });
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  resetConnectivityForTests();
});

describe("puntino offline nelle intestazioni", () => {
  it("con la palestra sta nel flusso accanto al gruppo, senza absolute né fixed", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    renderIn("/gym", <ModeSwitch />);

    act(() => reportNetworkFailure());

    const button = screen.getByRole("button", { name: indicatorName });
    const group = screen.getByRole("group", { name: "Sezione" });
    expect(group.parentElement).toContainElement(button);
    expect(button.parentElement).toHaveClass("shrink-0", "-my-1");
    expect(button.parentElement).not.toHaveClass("absolute");
    expect(button.parentElement).not.toHaveClass("fixed");
  });

  it("senza la palestra il pulsante c'è al centro della riga, con margine negativo che non allunga la riga", () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    renderIn("/", <ModeSwitch />);

    act(() => reportNetworkFailure());

    const button = screen.getByRole("button", { name: indicatorName });
    expect(button.parentElement).toHaveClass("-my-1");
  });

  it("online il pulsante non c'è", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    renderIn("/gym", <ModeSwitch />);

    expect(screen.queryByRole("button", { name: /Offline/ })).not.toBeInTheDocument();
  });

  it("in Impostazioni senza la palestra il pulsante c'è accanto al titolo", () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    vi.mocked(useMe).mockReturnValue({
      data: { id: 1, username: "alice", display_name: "Alice", role: "user", permissions: [], mcp_url: "" },
    } as unknown as ReturnType<typeof useMe>);
    renderIn("/settings", <SettingsPage />);

    act(() => reportNetworkFailure());

    expect(screen.getByRole("heading", { name: "Impostazioni" })).toBeInTheDocument();
    const button = screen.getByRole("button", { name: indicatorName });
    expect(screen.getByRole("heading", { name: "Impostazioni" }).parentElement).toContainElement(button);
    // Margine negativo: la riga del titolo resta alta quanto il testo, il pulsante resta da 44 px.
    expect(button.parentElement).toHaveClass("-my-2.5");
    expect(button.parentElement).not.toHaveClass("absolute");
  });

  it("nel dettaglio allenamento il pulsante è nel flusso accanto al titolo lungo, e non copre Azioni", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    const longWorkout = { ...finished, name: "Allenamento di prova con un titolo molto lungo che deve essere troncato" } as Workout;
    vi.mocked(useWorkout).mockReturnValue({ data: longWorkout, isLoading: false, isError: false } as unknown as ReturnType<typeof useWorkout>);
    vi.mocked(useApplyToTemplate).mockReturnValue({ mutate: vi.fn(), isPending: false, isSuccess: false } as unknown as ReturnType<typeof useApplyToTemplate>);
    vi.mocked(useSaveAsTemplate).mockReturnValue({ mutate: vi.fn(), isPending: false, isSuccess: false } as unknown as ReturnType<typeof useSaveAsTemplate>);
    vi.mocked(useDeleteWorkout).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useDeleteWorkout>);
    renderIn(
      "/gym/history/9",
      <Routes>
        <Route path="/gym/history/:id" element={<WorkoutDetailPage />} />
      </Routes>,
    );

    act(() => reportNetworkFailure());

    const button = screen.getByRole("button", { name: indicatorName });
    const heading = screen.getByRole("heading", { level: 1 });
    const actions = screen.getByRole("button", { name: "Azioni allenamento" });
    expect(heading).toHaveClass("truncate", "min-w-0");
    // Il puntino è fratello del titolo, nel flusso: il titolo cede spazio e Azioni resta fuori dal suo contenitore.
    expect(heading.parentElement).toContainElement(button);
    expect(heading.parentElement).not.toContainElement(actions);
    expect(button.parentElement).toHaveClass("shrink-0");
    expect(button.parentElement).not.toHaveClass("absolute");
    expect(button.parentElement).not.toHaveClass("fixed");
    expect(actions.closest("header")).toContainElement(button);
  });

  it("in Aggiungi alimento offline il pulsante c'è accanto al titolo, e online no", () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    renderIn("/search?date=2026-08-26&meal=breakfast", <SearchPage />);

    expect(screen.queryByRole("button", { name: /Offline/ })).not.toBeInTheDocument();

    act(() => reportNetworkFailure());

    const button = screen.getByRole("button", { name: indicatorName });
    const heading = screen.getByRole("heading", { name: "Aggiungi alimento" });
    expect(heading.parentElement).toContainElement(button);
    // Stesso margine negativo di Impostazioni: il titolo resta alto quanto il testo.
    expect(button.parentElement).toHaveClass("-my-2.5", "shrink-0");
    expect(button.parentElement).not.toHaveClass("absolute");
    expect(button.parentElement).not.toHaveClass("fixed");
    // Il pulsante di scansione resta dov'è, nell'header.
    expect(screen.getByRole("button", { name: "Scansiona codice a barre" })).toBeInTheDocument();
  });

  it("il fumetto si sposta dentro lo schermo quando il puntino è vicino al bordo", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    const screenWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    // Puntino a 305 px, largo 28 px; fumetto largo 246 px.
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const isBubble = this.getAttribute("role") === "status";
      const left = isBubble ? 0 : 305;
      const width = isBubble ? 246 : 28;
      return { left, width, x: left, right: left + width, top: 0, bottom: 0, height: 0, y: 0 } as DOMRect;
    });
    renderIn("/gym", <ModeSwitch />);
    act(() => reportNetworkFailure());

    fireEvent.click(screen.getByRole("button", { name: indicatorName }));

    // Centrato sarebbe a 196 px e uscirebbe; con 8 px di margine il bordo sinistro va a 121 px.
    expect(screen.getByRole("status")).toHaveStyle({ marginLeft: "-75px" });
    rect.mockRestore();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: screenWidth });
  });
});
