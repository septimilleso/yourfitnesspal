import { hashKey, QueryObserver, type QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";

import { createQueryClient } from "../lib/queryClient";
import { isPrunableKey, pruneStaleQueries, PRUNE_AGE_MS } from "./cachePrune";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 13, 12);
const OLD = NOW - 20 * DAY_MS;
const RECENT = NOW - 3 * DAY_MS;

const OLD_DAY = ["diary", "day", "2026-09-01"] as const;
const RECENT_DAY = ["diary", "day", "2026-10-10"] as const;

const observers: Array<() => void> = [];

afterEach(() => {
  while (observers.length > 0) observers.pop()?.();
});

function seed(queryClient: QueryClient, key: readonly unknown[], updatedAt: number): void {
  queryClient.setQueryData(key, { value: key.join("|") }, { updatedAt });
}

function keys(queryClient: QueryClient): string[] {
  return queryClient.getQueryCache().getAll().map((query) => JSON.stringify(query.queryKey));
}

describe("PRUNE_AGE_MS", () => {
  it("vale 14 giorni", () => {
    expect(PRUNE_AGE_MS).toBe(14 * DAY_MS);
  });
});

describe("isPrunableKey", () => {
  it.each([
    [["diary", "day", "2026-10-01"], true],
    [["diary", "week", "2026-09-28"], true],
    [["diary", "range", "2026-09-01", "2026-09-30"], true],
    [["weight", "range", "2026-09-01", "2026-09-30"], true],
    [["gym", "stats", "range", "2026-09-01", "2026-09-30"], true],
    [["gym", "stats", "progress", 4, "2026-09-01", "2026-09-30"], true],
    [["gym", "workout", 7], true],
    [["gym", "template", 3], true],
    [["saved-weeks", "detail", 2], true],
    [["gym", "workout", "active"], false],
    [["gym", "workout"], false],
    [["diary", "day"], false],
    [["diary", "week"], false],
    [["diary", "range", "2026-09-01"], false],
    [["me"], false],
    [["goals"], false],
    [["gym", "history"], false],
    [["gym", "stats", "count"], false],
    [["gym", "stats", "exercises"], false],
    [["saved-weeks", "list"], false],
    [["streak"], false],
  ])("%j → %s", (key, expected) => {
    expect(isPrunableKey(key)).toBe(expected);
  });
});

describe("pruneStaleQueries", () => {
  it("rimuove il giorno di 20 giorni prima e tiene quello di 3 giorni prima", () => {
    const queryClient = createQueryClient(true);
    seed(queryClient, OLD_DAY, OLD);
    seed(queryClient, RECENT_DAY, RECENT);

    const removed = pruneStaleQueries(queryClient, new Set(), NOW);

    expect(removed).toBe(1);
    expect(queryClient.getQueryData(OLD_DAY)).toBeUndefined();
    expect(queryClient.getQueryData(RECENT_DAY)).toEqual({ value: RECENT_DAY.join("|") });
  });

  it("tiene una query vecchia che ha ancora un osservatore", () => {
    const queryClient = createQueryClient(true);
    seed(queryClient, OLD_DAY, OLD);
    const observer = new QueryObserver(queryClient, { queryKey: OLD_DAY, enabled: false });
    observers.push(observer.subscribe(() => undefined));

    const removed = pruneStaleQueries(queryClient, new Set(), NOW);

    expect(removed).toBe(0);
    expect(queryClient.getQueryData(OLD_DAY)).toBeDefined();
  });

  it("tiene una query vecchia il cui hash è in keepHashes", () => {
    const queryClient = createQueryClient(true);
    seed(queryClient, OLD_DAY, OLD);

    const removed = pruneStaleQueries(queryClient, new Set([hashKey(OLD_DAY)]), NOW);

    expect(removed).toBe(0);
    expect(queryClient.getQueryData(OLD_DAY)).toBeDefined();
  });

  it("non tocca mai l'allenamento attivo, anche se vecchio", () => {
    const queryClient = createQueryClient(true);
    const active = ["gym", "workout", "active"];
    seed(queryClient, active, OLD);

    const removed = pruneStaleQueries(queryClient, new Set(), NOW);

    expect(removed).toBe(0);
    expect(queryClient.getQueryData(active)).toBeDefined();
  });

  it("rimuove un allenamento finito vecchio con id numerico", () => {
    const queryClient = createQueryClient(true);
    seed(queryClient, ["gym", "workout", 7], OLD);

    expect(pruneStaleQueries(queryClient, new Set(), NOW)).toBe(1);
    expect(queryClient.getQueryData(["gym", "workout", 7])).toBeUndefined();
  });

  it("tiene goals, me e le altre famiglie senza data o identificativo", () => {
    const queryClient = createQueryClient(true);
    seed(queryClient, ["goals"], OLD);
    seed(queryClient, ["me"], OLD);
    seed(queryClient, ["gym", "history"], OLD);

    const removed = pruneStaleQueries(queryClient, new Set(), NOW);

    expect(removed).toBe(0);
    expect(keys(queryClient)).toHaveLength(3);
  });

  it("tiene le query recenti di ogni famiglia con data", () => {
    const queryClient = createQueryClient(true);
    seed(queryClient, ["diary", "week", "2026-10-05"], RECENT);
    seed(queryClient, ["weight", "range", "2026-09-01", "2026-10-13"], RECENT);
    seed(queryClient, ["gym", "stats", "range", "2026-09-01", "2026-10-13"], RECENT);
    seed(queryClient, ["gym", "template", 3], RECENT);

    expect(pruneStaleQueries(queryClient, new Set(), NOW)).toBe(0);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(4);
  });
});

describe("pruneStaleQueries: query senza dati o in fetch", () => {
  it("tiene una query vuota (mai caricata) anche con chiave vecchia e senza osservatori", () => {
    const queryClient = createQueryClient(true);
    queryClient.getQueryCache().build(queryClient, { queryKey: OLD_DAY });

    expect(pruneStaleQueries(queryClient, new Set(), NOW)).toBe(0);
    expect(queryClient.getQueryCache().find({ queryKey: OLD_DAY })).toBeDefined();
  });

  it("tiene una query vecchia in fetch, anche se i dati in cache sono vecchi", () => {
    const queryClient = createQueryClient(true);
    seed(queryClient, OLD_DAY, OLD);
    // Se la query viene rimossa, la promessa del fetch viene annullata: il rifiuto è atteso e non va propagato.
    queryClient
      .fetchQuery({ queryKey: OLD_DAY, queryFn: () => new Promise<never>(() => undefined) })
      .catch(() => undefined);
    expect(queryClient.getQueryState(OLD_DAY)?.fetchStatus).toBe("fetching");

    expect(pruneStaleQueries(queryClient, new Set(), NOW)).toBe(0);
    expect(queryClient.getQueryData(OLD_DAY)).toBeDefined();
  });
});
