import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { type QueryClient, QueryClientProvider, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { client } from "../api/client";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests, retryConnection } from "../native/connectivity";
import { createQueryClient } from "./queryClient";
import { useOfflineUnavailable } from "./useOfflineUnavailable";

const platform = vi.hoisted(() => ({ native: true }));

vi.mock("../native/platform", () => ({ isNative: () => platform.native }));

const fetchMock = vi.fn<typeof fetch>();

let queryClient: QueryClient;

type ProbeOptions = Partial<Pick<UseQueryOptions<string>, "enabled" | "placeholderData" | "staleTime">> & {
  queryFn?: () => Promise<string>;
};

// Query "probe": di default parte al montaggio e il suo fetch non termina mai, come una rete che non risponde.
function Probe({ queryFn = () => new Promise<string>(() => undefined), ...options }: ProbeOptions) {
  const query = useQuery<string>({ queryKey: ["probe"], queryFn, staleTime: 0, ...options });
  const unavailable = useOfflineUnavailable(query);
  return <div>{unavailable ? "non disponibile" : "disponibile"}</div>;
}

function renderProbe(options: ProbeOptions = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Probe {...options} />
    </QueryClientProvider>,
  );
}

function probeQuery() {
  return queryClient.getQueryCache().find({ queryKey: ["probe"] })!;
}

beforeEach(() => {
  platform.native = true;
  vi.useFakeTimers();
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

describe("useOfflineUnavailable sull'IPA", () => {
  it("con la rete che manca e la query in pausa senza dati restituisce true", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderProbe({ queryFn: () => client.get<string>("/probe") });

    // Il primo tentativo fallisce, poi il retryer attende 1 s e va in pausa perché la rete manca.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(probeQuery().state.fetchStatus).toBe("paused");
    expect(screen.getByText("non disponibile")).toBeInTheDocument();
  });

  it("dopo retryConnection, con la query di nuovo in fetching e la rete ancora assente, resta true", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    renderProbe({ queryFn: () => client.get<string>("/probe") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    await act(async () => {
      retryConnection();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(probeQuery().state.fetchStatus).toBe("fetching");
    expect(screen.getByText("non disponibile")).toBeInTheDocument();
  });

  it("con dati in cache e la query in pausa restituisce false", () => {
    queryClient.setQueryData(["probe"], "vecchi");
    reportNetworkFailure();

    renderProbe();

    expect(probeQuery().state.fetchStatus).toBe("paused");
    expect(screen.getByText("disponibile")).toBeInTheDocument();
  });

  it("con la query disabilitata offline restituisce false", () => {
    reportNetworkFailure();

    renderProbe({ enabled: false });

    expect(probeQuery().state.fetchStatus).toBe("idle");
    expect(screen.getByText("disponibile")).toBeInTheDocument();
  });

  it("con placeholderData offline restituisce true", () => {
    reportNetworkFailure();

    renderProbe({ placeholderData: "segnaposto" });

    // Il segnaposto non entra nello stato della query, quindi lo stato non ha dati.
    expect(probeQuery().state.data).toBeUndefined();
    expect(probeQuery().state.fetchStatus).toBe("paused");
    expect(screen.getByText("non disponibile")).toBeInTheDocument();
  });

  it("con la rete presente e la query in caricamento restituisce false", () => {
    renderProbe();

    expect(probeQuery().state.fetchStatus).toBe("fetching");
    expect(screen.getByText("disponibile")).toBeInTheDocument();
  });

  it("quando la rete torna il messaggio sparisce", () => {
    reportNetworkFailure();
    renderProbe();
    expect(screen.getByText("non disponibile")).toBeInTheDocument();

    act(() => reportNetworkSuccess());

    expect(screen.getByText("disponibile")).toBeInTheDocument();
  });

  it("con isNative falso restituisce false", () => {
    platform.native = false;
    reportNetworkFailure();

    renderProbe();

    expect(probeQuery().state.fetchStatus).toBe("paused");
    expect(screen.getByText("disponibile")).toBeInTheDocument();
  });

  it("con un oggetto senza fetchStatus restituisce false", () => {
    reportNetworkFailure();

    const { result } = renderHook(() => useOfflineUnavailable({ data: undefined, isPlaceholderData: false }));

    expect(result.current).toBe(false);
  });
});
