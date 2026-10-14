import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gymKeys } from "../../api/gym";
import { createQueryClient } from "../../lib/queryClient";
import { reportNetworkFailure, resetConnectivityForTests, retryConnection } from "../../native/connectivity";
import { historyPage } from "../../test/prefetchFixtures";
import HistoryPage from "./HistoryPage";

vi.mock("../../native/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

// Il client nativo è montato come nell'app: così onlineManager riprende le query in pausa anche dopo lo smontaggio.
beforeEach(() => {
  queryClient = createQueryClient(true);
  queryClient.mount();
  fetchMock = vi.fn().mockRejectedValue(new TypeError("Load failed"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  queryClient.unmount();
  queryClient.clear();
  vi.unstubAllGlobals();
  resetConnectivityForTests();
});

// Restituisce unmount, per simulare la schermata che esce dal montaggio.
function renderHistory() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gym/history"]}>
        <Routes>
          <Route path="/gym/history" element={<HistoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function historyFetchStatus() {
  return queryClient.getQueryState(gymKeys.history)?.fetchStatus;
}

describe("Storico offline dopo smontaggio e ripresa", () => {
  it("con dati in cache resta visibile dopo smontaggio e ripresa, senza errore rosso", async () => {
    queryClient.setQueryData(gymKeys.history, { pages: [historyPage(null)], pageParams: [null] });
    reportNetworkFailure();

    const first = renderHistory();
    await waitFor(() => expect(historyFetchStatus()).toBe("paused"));
    first.unmount();

    retryConnection();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(historyFetchStatus()).toBe("idle"));

    renderHistory();

    expect(await screen.findByText("Allenamento 25")).toBeInTheDocument();
    expect(screen.queryByText("Errore nel caricamento dello storico.")).not.toBeInTheDocument();
    expect(queryClient.getQueryState(gymKeys.history)?.status).toBe("success");
  });
});
