import { act, cleanup, render, screen } from "@testing-library/react";
import { type QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { client } from "../api/client";
import { createQueryClient } from "../lib/queryClient";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "../native/connectivity";
import OfflineBar from "./OfflineBar";

const platform = vi.hoisted(() => ({ native: true }));

vi.mock("../native/platform", () => ({ isNative: () => platform.native }));

const fetchMock = vi.fn<typeof fetch>();

let queryClient: QueryClient;

// Risposta minimale: il client usa solo ok, status e json().
function response(status: number, body?: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError("no json")) : Promise.resolve(body)),
  } as unknown as Response;
}

// Schermata con la query "diary": quando staleTime è 0 la query parte al montaggio.
function DiaryPage({ staleTime }: { staleTime: number }) {
  const diary = useQuery({
    queryKey: ["diary"],
    queryFn: () => client.get<string>("/diary"),
    staleTime,
  });
  return <div>{`Diary ${diary.data ?? ""}`}</div>;
}

function renderPage(staleTime = Infinity) {
  return render(
    <QueryClientProvider client={queryClient}>
      <OfflineBar />
      <DiaryPage staleTime={staleTime} />
    </QueryClientProvider>,
  );
}

function localTime(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month, day, hour, minute).getTime();
}

beforeEach(() => {
  platform.native = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 15, 0));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  queryClient = createQueryClient(true);
  queryClient.mount();
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  resetConnectivityForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OfflineBar sull'IPA", () => {
  it("mostra l'ora dei dati in cache quando la rete manca", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();

    act(() => reportNetworkFailure());

    expect(screen.getByRole("status")).toHaveTextContent("Offline, dati delle 14:05");
  });

  it("sparisce quando la rete torna", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();
    act(() => reportNetworkFailure());

    act(() => reportNetworkSuccess());

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("non compare con la rete presente", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("indica il giorno quando i dati non sono di oggi", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 11, 9, 30) });
    renderPage();

    act(() => reportNetworkFailure());

    expect(screen.getByRole("status")).toHaveTextContent("Offline, dati del 11/10 alle 09:30");
  });

  it("C5: quando la rete torna la schermata si aggiorna da sola e la barra sparisce", async () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage(0);
    const query = queryClient.getQueryCache().find({ queryKey: ["diary"] })!;
    // Il primo tentativo fallisce, poi il retryer attende 1 s e va in pausa perché la rete manca.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(query.state.fetchStatus).toBe("paused");
    expect(screen.getByRole("status")).toHaveTextContent("Offline, dati delle 14:05");
    expect(screen.getByText("Diary vecchi")).toBeInTheDocument();

    fetchMock.mockResolvedValue(response(200, "nuovi"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(screen.getByText("Diary nuovi")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("OfflineBar nel browser", () => {
  it("non rende nulla e non avvia il ripristino della connessione", () => {
    platform.native = false;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();

    act(() => reportNetworkFailure());

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 20000);
  });
});
