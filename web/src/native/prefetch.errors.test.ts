import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gymKeys } from "../api/gym";
import StreakCard from "../components/StreakCard";
import { createQueryClient } from "../lib/queryClient";
import { meWith, routeFetch } from "../test/prefetchFixtures";
import { isOffline, resetConnectivityForTests } from "./connectivity";
import { MAX_CONCURRENT, runPrefetchRound } from "./prefetch";
import { flushQueryPersistenceForTests, startQueryPersistence } from "./queryPersistence";
import { clearToken, getToken, setToken } from "./session";

const preferences = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
const filesystem = vi.hoisted(() => ({ writeFile: vi.fn(), readFile: vi.fn(), deleteFile: vi.fn() }));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("./platform", () => ({ isNative: () => true }));

const TODAY = "2026-10-13";
const DAY_MS = 24 * 60 * 60 * 1000;
// Terza richiesta del giro: le prime due partono insieme con i due lavoratori.
const THIRD_REQUEST = 2;

let queryClient: QueryClient;
let routed: ReturnType<typeof routeFetch>;

function authOf(init?: RequestInit): unknown {
  return (init?.headers as Record<string, unknown> | undefined)?.Authorization;
}

// Imposta la rete sul fetch instradato e lancia il giro.
async function runRound(overrides: Parameters<typeof routeFetch>[0] = {}) {
  routed = routeFetch(overrides);
  vi.stubGlobal("fetch", routed.fetch);
  return runPrefetchRound(queryClient);
}

// Rete assente dalla terza richiesta in poi: anche quella già in volo sull'altro lavoratore fallisce.
const networkDown = ({ index }: { index: number }) =>
  index >= THIRD_REQUEST ? { reject: new TypeError("Failed to fetch") } : undefined;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 13, 10, 0));
  vi.clearAllMocks();
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue({ uri: "file:///query-cache.json" });
  filesystem.deleteFile.mockResolvedValue(undefined);
  await setToken("tok-a");
  queryClient = createQueryClient(true);
  queryClient.mount();
  queryClient.setQueryData(["me"], meWith(["workouts.use", "diary.copy"]));
});

afterEach(async () => {
  queryClient.unmount();
  queryClient.clear();
  await clearToken();
  resetConnectivityForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("runPrefetchRound: rete (C6)", () => {
  it("alla terza richiesta la rete manca: esito aborted senza lanciare e senza nuove richieste", async () => {
    await expect(runRound({ "*": networkDown })).resolves.toBe("aborted");

    // L'altro lavoratore può avere già una richiesta in volo: al massimo una in più della terza.
    expect(routed.urls.length).toBeLessThanOrEqual(THIRD_REQUEST + MAX_CONCURRENT);
    expect(isOffline()).toBe(true);
  });

  it("con la rete assente nessuna query è in pausa o in errore", async () => {
    await runRound({ "*": networkDown });

    const states = queryClient.getQueryCache().getAll().map((query) => query.state);
    expect(states.some((state) => state.fetchStatus === "paused" || state.status === "error")).toBe(false);
  });

  it("con la rete assente non pulisce le query vecchie", async () => {
    queryClient.setQueryData(["diary", "day", "2026-09-01"], { date: "2026-09-01" }, { updatedAt: Date.now() - 20 * DAY_MS });

    await runRound({ "*": networkDown });

    expect(queryClient.getQueryData(["diary", "day", "2026-09-01"])).toEqual({ date: "2026-09-01" });
  });

  it("dopo un giro interrotto le scritture della cache riprendono", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const stop = startQueryPersistence(queryClient);

    await runRound({ "*": networkDown });
    queryClient.setQueryData(["diary", "day", TODAY], { date: TODAY });
    await vi.advanceTimersByTimeAsync(1000);
    await flushQueryPersistenceForTests();

    // Se la sospensione non fosse stata rilasciata, nessuna scrittura partirebbe.
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("runPrefetchRound: errori HTTP (C6)", () => {
  it("un 500 su /stats/streak lascia ['streak'] com'era e la card non mostra errore", async () => {
    queryClient.setQueryData(["streak"], { current: 3, best: 5 });

    const outcome = await runRound({ "/stats/streak": { status: 500, body: { detail: "boom" } } });

    expect(outcome).toBe("completed");
    expect(queryClient.getQueryState(["streak"])?.status).toBe("success");
    expect(queryClient.getQueryData(["streak"])).toEqual({ current: 3, best: 5 });
    expect(queryClient.getQueryData(["diary", "day", TODAY])).toBeDefined();

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(StreakCard, { mode: "diet" })));
    expect(screen.getByText("3 giorni di fila")).toBeInTheDocument();
    expect(screen.queryByText("Impossibile caricare la serie.")).toBeNull();
  });

  it("ogni URL compare al più una volta, anche con errori", async () => {
    await runRound({
      "/stats/streak": { status: 500, body: { detail: "boom" } },
      "/goals": { status: 502 },
    });

    expect(new Set(routed.urls).size).toBe(routed.urls.length);
  });

  it("un 502 con risposta non JSON non tocca la sessione né il file", async () => {
    const outcome = await runRound({ "/stats/gym/count": { status: 502 } });

    expect(outcome).toBe("completed");
    expect(getToken()).toBe("tok-a");
    expect(filesystem.deleteFile).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(gymKeys.statsCount)).toBeUndefined();
  });
});

describe("runPrefetchRound: sessione (C7)", () => {
  it("401 di sessione: token e file via client, me null, nessuna richiesta dopo, esito aborted", async () => {
    const outcome = await runRound({ "/stats/streak": { status: 401, body: { detail: "unauthorized" } } });

    expect(outcome).toBe("aborted");
    expect(getToken()).toBeNull();
    expect(filesystem.deleteFile).toHaveBeenCalled();
    expect(queryClient.getQueryData(["me"])).toBeNull();
    // Come sopra: la richiesta dell'altro lavoratore può essere già partita, nessuna dopo.
    const unauthorized = routed.urls.indexOf("/stats/streak");
    expect(routed.urls.length).toBeLessThanOrEqual(unauthorized + MAX_CONCURRENT);
  });

  it("cambio di sessione durante il giro: nessuna richiesta col token vecchio dopo il cambio, nessuna scrittura", async () => {
    let callsAtChange = 0;

    const outcome = await runRound({
      "/goals": async () => {
        callsAtChange = routed.fetch.mock.calls.length;
        await setToken("tok-b");
        return undefined;
      },
    });

    expect(outcome).toBe("aborted");
    expect(queryClient.getQueryData(["goals"])).toBeUndefined();
    const afterChange = routed.fetch.mock.calls.slice(callsAtChange);
    expect(afterChange.filter(([, init]) => authOf(init) === "Bearer tok-a")).toEqual([]);
  });
});

describe("runPrefetchRound: concorrenza (C10)", () => {
  it("con due lavoratori non ci sono più di due richieste in volo e il giro completa", async () => {
    vi.useRealTimers();
    const base = routeFetch();
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return base.fetch(url, init);
    });

    const outcome = await runPrefetchRound(queryClient);

    expect(outcome).toBe("completed");
    expect(maxInFlight).toBeLessThanOrEqual(MAX_CONCURRENT);
    expect(maxInFlight).toBe(MAX_CONCURRENT);
  });
});
