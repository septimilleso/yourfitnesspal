import type { QueryClient } from "@tanstack/react-query";

// Una query con data o identificativo più vecchia di 14 giorni, senza osservatori, esce dalla cache su file.
export const PRUNE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function isDate(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}

function isId(value: unknown): boolean {
  return typeof value === "number";
}

// Le famiglie con data o identificativo: `["gym","workout","active"]` e le famiglie senza parametri restano fuori.
export function isPrunableKey(queryKey: readonly unknown[]): boolean {
  const [family, part, ...rest] = queryKey;

  if (family === "diary") {
    if (part === "day" || part === "week") return rest.length === 1 && isDate(rest[0]);
    if (part === "range") return rest.length === 2 && isDate(rest[0]) && isDate(rest[1]);
    return false;
  }
  if (family === "weight") {
    return part === "range" && rest.length === 2 && isDate(rest[0]) && isDate(rest[1]);
  }
  if (family === "gym") {
    if (part === "stats") {
      const [kind, ...args] = rest;
      if (kind === "range") return args.length === 2 && isDate(args[0]) && isDate(args[1]);
      if (kind === "progress") return args.length === 3 && isId(args[0]) && isDate(args[1]) && isDate(args[2]);
      return false;
    }
    if (part === "workout") return rest.length === 1 && isId(rest[0]);
    if (part === "template") return rest.length === 1 && isId(rest[0]);
    return false;
  }
  if (family === "saved-weeks") return part === "detail" && rest.length === 1 && isId(rest[0]);
  return false;
}

// Rimuove le query di famiglie con data, vecchie, senza osservatori e fuori dal giro appena concluso. Restituisce il numero rimosso.
export function pruneStaleQueries(queryClient: QueryClient, keepHashes: ReadonlySet<string>, now: number): number {
  const cache = queryClient.getQueryCache();
  let removed = 0;
  for (const query of cache.getAll()) {
    if (!isPrunableKey(query.queryKey)) continue;
    if (query.getObserversCount() > 0 || keepHashes.has(query.queryHash)) continue;
    if (query.state.dataUpdatedAt >= now - PRUNE_AGE_MS) continue;
    cache.remove(query);
    removed++;
  }
  return removed;
}
