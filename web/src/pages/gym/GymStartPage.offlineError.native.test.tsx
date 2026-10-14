import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../api/client";
import { gymKeys } from "../../api/gym";
import { createQueryClient } from "../../lib/queryClient";
import { reportNetworkFailure, resetConnectivityForTests, retryConnection } from "../../native/connectivity";
import GymStartPage from "./GymStartPage";

vi.mock("../../native/platform", () => ({ isNative: () => true }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));

const cachedTemplates = {
  folders: [],
  templates: [{ id: 1, name: "Modello 1", folder_id: null, last_used_at: null, exercise_names: [] }],
};

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
function renderGymStart() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gym"]}>
        <Routes>
          <Route path="/gym" element={<GymStartPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function templatesFetchStatus() {
  return queryClient.getQueryState(gymKeys.templates)?.fetchStatus;
}

describe("Modelli offline dopo smontaggio e ripresa", () => {
  it("con dati in cache resta visibile dopo smontaggio e ripresa, senza errore rosso", async () => {
    queryClient.setQueryData(gymKeys.templates, cachedTemplates);
    reportNetworkFailure();

    const first = renderGymStart();
    await waitFor(() => expect(templatesFetchStatus()).toBe("paused"));
    first.unmount();

    retryConnection();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(templatesFetchStatus()).toBe("idle"));

    renderGymStart();

    expect(screen.getByText("Modello 1")).toBeInTheDocument();
    expect(screen.queryByText("Errore nel caricamento dei modelli.")).not.toBeInTheDocument();
    expect(queryClient.getQueryState(gymKeys.templates)?.status).toBe("success");
  });

  it("senza dati in cache mostra Non disponibile offline dopo smontaggio e ripresa", async () => {
    reportNetworkFailure();

    const first = renderGymStart();
    await waitFor(() => expect(templatesFetchStatus()).toBe("paused"));
    // Senza dati React Query annulla con ripristino il retryer allo smontaggio: al ritorno della rete non parte nulla.
    first.unmount();

    retryConnection();
    renderGymStart();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Errore nel caricamento dei modelli.")).not.toBeInTheDocument();
  });

  it("un ApiError 502 su una query con dati la porta in error e conserva i dati", async () => {
    queryClient.setQueryData(gymKeys.templates, cachedTemplates);

    await expect(
      queryClient.fetchQuery({
        queryKey: gymKeys.templates,
        queryFn: () => Promise.reject(new ApiError(502, "bad gateway", null)),
        retry: false,
      }),
    ).rejects.toThrow();

    const state = queryClient.getQueryState(gymKeys.templates);
    expect(state?.status).toBe("error");
    expect(queryClient.getQueryData(gymKeys.templates)).toEqual(cachedTemplates);
  });

  it("un 401 su una query con dati porta [\"me\"] a null", async () => {
    queryClient.setQueryData(["me"], { id: 1 });
    queryClient.setQueryData(gymKeys.templates, cachedTemplates);

    await expect(
      queryClient.fetchQuery({
        queryKey: gymKeys.templates,
        queryFn: () => Promise.reject(new ApiError(401, "unauthorized", {})),
        retry: false,
      }),
    ).rejects.toThrow();

    expect(queryClient.getQueryData(["me"])).toBeNull();
  });
});
