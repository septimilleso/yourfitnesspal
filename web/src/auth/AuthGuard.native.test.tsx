import { act, render, screen, waitFor } from "@testing-library/react";
import { type QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Me } from "../api/auth";
import { client } from "../api/client";
import { createQueryClient } from "../lib/queryClient";
import { isOffline, resetConnectivityForTests } from "../native/connectivity";
import { clearPersistedQueryCache } from "../native/queryPersistence";
import { clearToken, getToken, setToken } from "../native/session";
import AuthGuard from "./AuthGuard";

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("../native/platform", () => ({ isNative: () => true }));
vi.mock("../native/queryPersistence", () => ({ clearPersistedQueryCache: vi.fn(() => Promise.resolve()) }));
vi.mock("../lib/push", () => ({ unsubscribeDeviceOnLogout: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
const clearPersistedQueryCacheMock = vi.mocked(clearPersistedQueryCache);

const me: Me = { id: 1, username: "simone", display_name: "Simone", role: "user", permissions: [], mcp_url: "" };

let queryClient: QueryClient;

// Risposta minimale: il client usa solo ok, status e json().
function response(status: number, body?: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError("no json")) : Promise.resolve(body)),
  } as unknown as Response;
}

// Pagina protetta: legge la cache con useQuery, senza ritirare i dati (staleTime infinito).
function StreakPage() {
  const streak = useQuery({
    queryKey: ["streak"],
    queryFn: () => client.get<{ days: number }>("/streak"),
    staleTime: Infinity,
  });
  return <div>{`Protected streak ${streak.data?.days ?? ""}`}</div>;
}

function renderApp(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<AuthGuard />}>
            <Route path="/" element={<StreakPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  clearPersistedQueryCacheMock.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  queryClient = createQueryClient(true);
  queryClient.mount();
});

afterEach(async () => {
  queryClient.unmount();
  queryClient.clear();
  resetConnectivityForTests();
  vi.unstubAllGlobals();
  await clearToken();
});

describe("AuthGuard on the native platform", () => {
  it("C1: shows cached protected data offline without the unreachable screen or login", async () => {
    await setToken("tok-cache");
    queryClient.setQueryData(["me"], me);
    queryClient.setQueryData(["streak"], { days: 3 });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderApp("/");
    void queryClient.invalidateQueries({ queryKey: ["me"] });

    await waitFor(() => {
      expect(isOffline()).toBe(true);
    });
    expect(screen.getByText("Protected streak 3")).toBeInTheDocument();
    expect(screen.queryByText("Impossibile contattare il server")).not.toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });

  it("C2a: shows the unreachable screen without a cached user and keeps the token", async () => {
    await setToken("tok-offline");
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderApp("/");

    expect(await screen.findByText("Impossibile contattare il server", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Riprova" })).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
    expect(getToken()).toBe("tok-offline");
  });

  it("C2b: goes to login without a token", async () => {
    fetchMock.mockResolvedValue(response(401, { detail: "unauthorized" }));

    renderApp("/");

    expect(await screen.findByText("Login Page")).toBeInTheDocument();
  });

  it("C3: keeps showing cached data when the server answers 502 with a body that is not JSON", async () => {
    await setToken("tok-502");
    queryClient.setQueryData(["me"], me);
    queryClient.setQueryData(["streak"], { days: 3 });
    fetchMock.mockResolvedValue(response(502));

    renderApp("/");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    });

    expect(screen.getByText("Protected streak 3")).toBeInTheDocument();
    expect(screen.queryByText("Impossibile contattare il server")).not.toBeInTheDocument();
    expect(getToken()).toBe("tok-502");
  });

  it("C4: a 401 unauthorized ends the session, clears the token and the file cache, then goes to login", async () => {
    await setToken("tok-401");
    queryClient.setQueryData(["me"], me);
    queryClient.setQueryData(["streak"], { days: 3 });
    fetchMock.mockResolvedValue(response(401, { detail: "unauthorized" }));

    renderApp("/");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    });

    expect(await screen.findByText("Login Page")).toBeInTheDocument();
    expect(getToken()).toBeNull();
    expect(clearPersistedQueryCacheMock).toHaveBeenCalled();
  });

  it("C4b: after a 401 unauthorized the in-memory cache is empty", async () => {
    await setToken("tok-401-cache");
    queryClient.setQueryData(["me"], me);
    queryClient.setQueryData(["streak"], { days: 3 });
    fetchMock.mockResolvedValue(response(401, { detail: "unauthorized" }));

    renderApp("/");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    });

    expect(await screen.findByText("Login Page")).toBeInTheDocument();
    expect(queryClient.getQueryData(["streak"])).toBeUndefined();
  });

  it("C4c: a 401 that does not remove the token also empties the in-memory cache", async () => {
    await setToken("tok-401-other");
    queryClient.setQueryData(["me"], me);
    queryClient.setQueryData(["streak"], { days: 3 });
    fetchMock.mockResolvedValue(response(401, { detail: "other" }));

    renderApp("/");
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
    });

    expect(await screen.findByText("Login Page")).toBeInTheDocument();
    expect(queryClient.getQueryData(["streak"])).toBeUndefined();
  });
});
