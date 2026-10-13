import { type QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "../lib/queryClient";
import { meWith } from "../test/prefetchFixtures";
import { runPrefetchRound } from "./prefetch";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "./connectivity";
import { resetPrefetchSchedulerForTests, startPrefetch } from "./prefetchScheduler";
import { clearToken, setToken } from "./session";

const platform = vi.hoisted(() => ({ native: true }));
const preferences = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("./platform", () => ({ isNative: () => platform.native }));
vi.mock("./prefetch", () => ({ runPrefetchRound: vi.fn() }));

const START = new Date(2026, 9, 13, 10, 0);
const IDLE_MS = 2000;
const FIFTEEN_MIN_MS = 15 * 60_000;
const ME = meWith(["workouts.use"]);

const round = vi.mocked(runPrefetchRound);
let queryClient: QueryClient;
let stop: (() => void) | undefined;

// Simula un cambio di visibilità della pagina (l'app torna o va in secondo piano).
function fireVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

// Avvia lo scheduler e poi arriva una risposta fresca di /auth/me, come al primo avvio.
function startWithFreshMe(): void {
  stop = startPrefetch(queryClient);
  queryClient.setQueryData(["me"], ME);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  platform.native = true;
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  round.mockReset().mockResolvedValue("completed");
  await setToken("tok-a");
  queryClient = createQueryClient(true);
  queryClient.mount();
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  resetPrefetchSchedulerForTests();
  resetConnectivityForTests();
  queryClient.unmount();
  await clearToken();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("avvio a freddo (R5, C10)", () => {
  it("non avvia il giro senza `me` in cache", async () => {
    stop = startPrefetch(queryClient);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(round).not.toHaveBeenCalled();
  });

  it("con `me` fresca avvia il giro dopo 2000 ms, una sola volta", async () => {
    startWithFreshMe();

    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(round).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(round).toHaveBeenCalledTimes(1);
    expect(round).toHaveBeenCalledWith(queryClient);

    // Nessun secondo giro senza un nuovo trigger e senza scadenza del throttle.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(round).toHaveBeenCalledTimes(1);
  });

  it("con `me` ripristinata dalla cache non avvia il giro e chiede una risposta nuova in idle", async () => {
    queryClient.setQueryData(["me"], ME, { updatedAt: Date.now() - 60_000 });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    stop = startPrefetch(queryClient);
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1);
    expect(invalidate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me"], exact: true });
    expect(round).not.toHaveBeenCalled();
  });

  it("usa requestIdleCallback con timeout di 5000 ms quando il browser lo offre", async () => {
    const requestIdle = vi.fn(() => 1);
    const cancelIdle = vi.fn();
    Object.assign(window, { requestIdleCallback: requestIdle, cancelIdleCallback: cancelIdle });
    try {
      startWithFreshMe();
      expect(requestIdle).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000 });
      expect(round).not.toHaveBeenCalled();
    } finally {
      stop?.();
      stop = undefined;
      Reflect.deleteProperty(window, "requestIdleCallback");
      Reflect.deleteProperty(window, "cancelIdleCallback");
    }
  });
});

describe("trigger e throttle (R5, C4)", () => {
  it("al ritorno in primo piano non parte entro 15 minuti dal giro completato, parte dopo", async () => {
    startWithFreshMe();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);
    const completedAt = Date.now();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN_MS + 1000 - (Date.now() - completedAt));
    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(2);
  });

  it("visibilitychange hidden non avvia nulla", async () => {
    startWithFreshMe();
    await vi.advanceTimersByTimeAsync(IDLE_MS);

    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN_MS + 1000);
    fireVisibility("hidden");
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);
  });

  it("un secondo trigger durante il giro in corso non ne avvia un altro", async () => {
    let finish!: (outcome: "completed") => void;
    round.mockReturnValueOnce(new Promise<"completed">((resolve) => (finish = resolve)));
    startWithFreshMe();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);

    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);

    finish("completed");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(FIFTEEN_MIN_MS);
    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(2);
  });

  it("un giro interrotto non aggiorna lastCompletedAt: il trigger successivo parte", async () => {
    round.mockResolvedValueOnce("aborted");
    startWithFreshMe();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);

    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(2);
  });

  it("un rifiuto di runPrefetchRound non blocca i giri successivi", async () => {
    round.mockRejectedValueOnce(new Error("boom"));
    startWithFreshMe();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);

    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(2);
  });

  it("al ritorno della rete dopo un avvio offline parte il primo giro", async () => {
    reportNetworkFailure();
    startWithFreshMe();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).not.toHaveBeenCalled();

    reportNetworkSuccess();
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);
  });
});

describe("condizioni (R6, C5, C20)", () => {
  it("nel web non registra listener e non avvia nulla", async () => {
    platform.native = false;
    const subscribe = vi.spyOn(queryClient.getQueryCache(), "subscribe");
    const addListener = vi.spyOn(document, "addEventListener");

    stop = startPrefetch(queryClient);
    queryClient.setQueryData(["me"], ME);
    fireVisibility("visible");
    reportNetworkSuccess();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(subscribe).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    expect(round).not.toHaveBeenCalled();
  });

  it("senza token non avvia il giro", async () => {
    await clearToken();
    startWithFreshMe();
    await vi.advanceTimersByTimeAsync(10_000);
    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(round).not.toHaveBeenCalled();
  });

  it("con rete offline non avvia il giro", async () => {
    reportNetworkFailure();
    startWithFreshMe();
    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(round).not.toHaveBeenCalled();
  });

  it("con `me` null non avvia il giro", async () => {
    stop = startPrefetch(queryClient);
    queryClient.setQueryData(["me"], null);
    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(round).not.toHaveBeenCalled();
  });
});

describe("refresh di `me` ripristinata (R5, C10)", () => {
  it("avvio offline con `me` vecchia: al ritorno della rete chiede `me` e poi un solo giro", async () => {
    queryClient.setQueryData(["me"], ME, { updatedAt: Date.now() - 60_000 });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    reportNetworkFailure();

    stop = startPrefetch(queryClient);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(invalidate).not.toHaveBeenCalled();

    reportNetworkSuccess();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me"], exact: true });

    queryClient.setQueryData(["me"], ME);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(round).toHaveBeenCalledTimes(1);
  });

  it("con `me` ripristinata e queryFn reale: invalidate, successo, un solo giro senza loop", async () => {
    const queryFn = vi.fn(async () => ME);
    queryClient.setQueryDefaults(["me"], { queryFn });
    queryClient.setQueryData(["me"], ME, { updatedAt: Date.now() - 60_000 });
    // Un osservatore con staleTime infinito: invalidateQueries rifà la query senza che il montaggio la rifaccia.
    const unsubscribe = new QueryObserver(queryClient, { queryKey: ["me"], staleTime: Infinity }).subscribe(() => undefined);

    try {
      stop = startPrefetch(queryClient);
      await vi.advanceTimersByTimeAsync(IDLE_MS);
      await vi.advanceTimersByTimeAsync(IDLE_MS);
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(round).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10 * 60_000);
      fireVisibility("visible");
      await vi.advanceTimersByTimeAsync(IDLE_MS);
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(round).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("non chiede `me` né offline, né senza token, né mentre è già in fetch", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(["me"], ME, { updatedAt: Date.now() - 60_000 });

    // Offline.
    reportNetworkFailure();
    stop = startPrefetch(queryClient);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    fireVisibility("visible");
    expect(invalidate).not.toHaveBeenCalled();
    stop();
    stop = undefined;
    reportNetworkSuccess();

    // Senza token.
    await clearToken();
    stop = startPrefetch(queryClient);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    fireVisibility("visible");
    expect(invalidate).not.toHaveBeenCalled();
    stop();
    stop = undefined;
    await setToken("tok-a");

    // Già in fetch: una richiesta che non risponde.
    void queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => new Promise<never>(() => undefined) });
    expect(queryClient.getQueryState(["me"])?.fetchStatus).toBe("fetching");
    stop = startPrefetch(queryClient);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    fireVisibility("visible");
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("cleanup", () => {
  it("toglie i trigger, annulla l'attesa in idle e riporta lo stato a idle", async () => {
    startWithFreshMe();
    stop?.();
    stop = undefined;
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).not.toHaveBeenCalled();

    fireVisibility("visible");
    queryClient.setQueryData(["me"], ME);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).not.toHaveBeenCalled();

    // Un nuovo avvio parte da fase "idle": il giro torna a funzionare.
    stop = startPrefetch(queryClient);
    queryClient.setQueryData(["me"], ME);
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(round).toHaveBeenCalledTimes(1);
  });
});
