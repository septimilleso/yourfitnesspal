import { type InfiniteData, type QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryPage } from "../api/gym";
import { EMPTY_FILTERS, gymKeys } from "../api/gym";
import { createQueryClient } from "../lib/queryClient";
import { PRESETS, presetPeriod } from "../lib/stats";
import { historyPage, meWith, routeFetch, WORKOUT_IDS, workoutFixture } from "../test/prefetchFixtures";
import { runPrefetchRound } from "./prefetch";
import { flushQueryPersistenceForTests, startQueryPersistence } from "./queryPersistence";
import { clearToken, setToken } from "./session";

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
const YESTERDAY = "2026-10-12";
const MONDAY = "2026-10-12";
const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS = PRESETS.map((days) => presetPeriod(days, TODAY));
const LAST_20_IDS = WORKOUT_IDS.slice(0, 20);

let queryClient: QueryClient;
let routed: ReturnType<typeof routeFetch>;

// Chiavi attese dopo un giro completo con palestra e settimane salvate (senza ["me"]).
function expectedKeys(): unknown[][] {
  return [
    ["diary", "day", TODAY],
    ["diary", "day", YESTERDAY],
    ["diary", "week", MONDAY],
    ["goals"],
    ["streak"],
    ["weight", "today"],
    ...PERIODS.flatMap((p) => [
      ["diary", "range", p.start, TODAY],
      ["weight", "range", p.start, TODAY],
    ]),
    ["gym", "templates"],
    ["gym", "template", 1],
    ["gym", "template", 2],
    ["gym", "template", 3],
    ["gym", "exercises", EMPTY_FILTERS],
    ["gym", "history"],
    ...LAST_20_IDS.map((id) => ["gym", "workout", id]),
    ["gym", "stats", "count"],
    ...PERIODS.map((p) => ["gym", "stats", "range", p.start, TODAY]),
    ["gym", "stats", "exercises"],
    ...PERIODS.map((p) => ["gym", "stats", "progress", 1, p.start, TODAY]),
    ["saved-weeks", "list"],
    ...Array.from({ length: 10 }, (_, i) => ["saved-weeks", "detail", i + 1]),
  ];
}

function expectedUrls(): string[] {
  return [
    `/diary/day/${TODAY}`,
    `/diary/day/${YESTERDAY}`,
    `/diary/week?start=${MONDAY}`,
    "/goals",
    "/stats/streak",
    "/weights/today",
    ...PERIODS.flatMap((p) => [`/diary/range?start=${p.start}&end=${TODAY}`, `/weights?start=${p.start}&end=${TODAY}`]),
    "/templates",
    "/templates/1",
    "/templates/2",
    "/templates/3",
    "/exercises?limit=200",
    "/workouts?limit=20",
    ...LAST_20_IDS.map((id) => `/workouts/${id}`),
    "/stats/gym/count",
    ...PERIODS.map((p) => `/stats/gym?start=${p.start}&end=${TODAY}`),
    "/stats/gym/exercises",
    ...PERIODS.map((p) => `/stats/gym/exercises/1?start=${p.start}&end=${TODAY}`),
    "/saved-weeks",
    ...Array.from({ length: 10 }, (_, i) => `/saved-weeks/${i + 1}`),
  ];
}

function cachedKeys(): unknown[][] {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => query.queryKey as unknown[])
    .filter((key) => key[0] !== "me");
}

// Confronto indipendente dall'ordine: le chiavi si serializzano e si ordinano.
function sortedJson(values: unknown[][] | string[]): string[] {
  return values.map((value) => JSON.stringify(value)).sort();
}

// Imposta la rete sul fetch instradato e lancia il giro.
async function runRound(overrides: Parameters<typeof routeFetch>[0] = {}) {
  routed = routeFetch(overrides);
  vi.stubGlobal("fetch", routed.fetch);
  return runPrefetchRound(queryClient);
}

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
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("runPrefetchRound: query scaricate (C3)", () => {
  it("con palestra e settimane salvate scrive esattamente le chiavi di R4", async () => {
    const outcome = await runRound();

    expect(outcome).toBe("completed");
    expect(sortedJson(cachedKeys())).toEqual(sortedJson(expectedKeys()));
  });

  it("chiama una sola volta ogni URL di R4 e nessuna URL fuori elenco", async () => {
    await runRound();

    expect(new Set(routed.urls).size).toBe(routed.urls.length);
    expect(sortedJson(routed.urls)).toEqual(sortedJson(expectedUrls()));
    expect(routed.urls.some((url) => url.includes("/workouts/active"))).toBe(false);
    expect(routed.urls.some((url) => url.includes("/foods"))).toBe(false);
    expect(routed.urls.some((url) => url.includes("/admin"))).toBe(false);
    expect(routed.urls.some((url) => url.includes("/auth/sessions"))).toBe(false);
    expect(routed.urls.some((url) => /^\/exercises\/\d+/.test(url))).toBe(false);
  });

  it("con /goals che risponde 404 scrive null", async () => {
    await runRound({ "/goals": { status: 404, body: { detail: "not found" } } });

    expect(queryClient.getQueryData(["goals"])).toBeNull();
  });

  it("scrive lo storico nella forma di useInfiniteQuery con la prima pagina", async () => {
    await runRound();

    const history = queryClient.getQueryData<InfiniteData<HistoryPage>>(gymKeys.history);
    expect(history?.pages).toHaveLength(1);
    expect(history?.pages[0].items).toHaveLength(20);
    expect(history?.pageParams).toEqual([null]);
  });
});

describe("runPrefetchRound: permessi (C5)", () => {
  it("senza permessi palestra e copia non chiama nessuna URL di palestra o settimane salvate", async () => {
    queryClient.setQueryData(["me"], meWith([]));

    const outcome = await runRound();

    expect(outcome).toBe("completed");
    const gymOrCopy = /^\/(templates|exercises|workouts|stats\/gym|saved-weeks)/;
    expect(routed.urls.filter((url) => gymOrCopy.test(url))).toEqual([]);
    expect(routed.urls).toContain(`/diary/day/${TODAY}`);
  });

  it("con solo workouts.use non chiama /saved-weeks ma chiama la palestra", async () => {
    queryClient.setQueryData(["me"], meWith(["workouts.use"]));

    await runRound();

    expect(routed.urls.some((url) => url.startsWith("/saved-weeks"))).toBe(false);
    expect(routed.urls).toContain("/templates");
  });

  it("admin senza permessi chiama la palestra e le settimane salvate", async () => {
    queryClient.setQueryData(["me"], meWith([], "admin"));

    await runRound();

    expect(routed.urls).toContain("/templates");
    expect(routed.urls).toContain("/saved-weeks");
  });

  it("senza utente in cache non fa richieste", async () => {
    queryClient.setQueryData(["me"], null);

    const outcome = await runRound();

    expect(outcome).toBe("aborted");
    expect(routed.urls).toEqual([]);
  });
});

describe("runPrefetchRound: dettagli saltati e pulizia (C9)", () => {
  it("non riscarica un allenamento già in cache, e lo tiene anche se è vecchio", async () => {
    const cached = workoutFixture(7);
    queryClient.setQueryData(gymKeys.workout(7), cached, { updatedAt: Date.now() - 20 * DAY_MS });

    await runRound();

    expect(routed.urls).not.toContain("/workouts/7");
    expect(queryClient.getQueryData(gymKeys.workout(7))).toBe(cached);
  });

  it("con lo storico aperto lascia le pagine e scarica comunque i dettagli", async () => {
    const initial: InfiniteData<HistoryPage> = {
      pages: [historyPage(null), historyPage("2026-10-01T10:00:00.000Z")],
      pageParams: [null, "2026-10-01T10:00:00.000Z"],
    };
    queryClient.setQueryData(gymKeys.history, initial);
    // Una HistoryPage aperta: la query ha un osservatore.
    const observer = new QueryObserver(queryClient, { queryKey: gymKeys.history, enabled: false });
    const unsubscribe = observer.subscribe(() => undefined);

    await runRound();
    unsubscribe();

    expect(queryClient.getQueryData(gymKeys.history)).toBe(initial);
    expect(queryClient.getQueryData<InfiniteData<HistoryPage>>(gymKeys.history)?.pages).toHaveLength(2);
    expect(sortedJson(routed.urls.filter((url) => url.startsWith("/workouts/")))).toEqual(
      sortedJson(LAST_20_IDS.map((id) => `/workouts/${id}`)),
    );
  });

  it("rimuove a fine giro una query con data di 20 giorni prima, e tiene quella recente", async () => {
    const now = Date.now();
    queryClient.setQueryData(["diary", "day", "2026-09-01"], { date: "2026-09-01" }, { updatedAt: now - 20 * DAY_MS });
    queryClient.setQueryData(["diary", "day", "2026-10-10"], { date: "2026-10-10" }, { updatedAt: now - 3 * DAY_MS });

    await runRound();

    expect(queryClient.getQueryData(["diary", "day", "2026-09-01"])).toBeUndefined();
    expect(queryClient.getQueryData(["diary", "day", "2026-10-10"])).toEqual({ date: "2026-10-10" });
  });

  it("non tocca mai l'allenamento attivo", async () => {
    const active = { id: 99, status: "in_progress" };
    queryClient.setQueryData(gymKeys.active, active, { updatedAt: Date.now() - 60 * DAY_MS });

    await runRound();

    expect(queryClient.getQueryData(gymKeys.active)).toBe(active);
  });
});

describe("runPrefetchRound: invalidazioni (C8)", () => {
  it("non invalida nessuna query e non scrive la chiave attiva", async () => {
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    await runRound();

    expect(spy).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(gymKeys.active)).toBeUndefined();
  });
});

describe("runPrefetchRound: scritture del file (C10)", () => {
  it("con il documento visibile riscrive il file una sola volta a fine giro", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const stop = startQueryPersistence(queryClient);

    await runRound();
    await vi.advanceTimersByTimeAsync(1000);
    await flushQueryPersistenceForTests();

    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    stop();
  });
});
