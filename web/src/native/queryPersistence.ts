import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { type DehydratedState, dehydrate, hydrate, type Query, type QueryClient } from "@tanstack/react-query";

import { gymKeys } from "../api/gym";
import { isNative } from "./platform";
import { getToken } from "./session";

// Cache delle query su file in Library: sopravvive alla chiusura dell'app, non la svuota iOS per inattività.
// Il file non contiene mai il token: le mutazioni non si persistono e il token arriva solo da una mutazione.
const CACHE_SCHEMA_VERSION = 1;
const CACHE_PATH = "yfp/query-cache.json";
const WRITE_DELAY_MS = 1000;

interface PersistedCache {
  buster: string;
  savedAt: number;
  state: DehydratedState;
}

// Un IPA nuova scarta la cache di quella precedente: VITE_BUILD_ID è il SHA del commit in CI.
function cacheBuster(): string {
  return `${CACHE_SCHEMA_VERSION}|${import.meta.env.VITE_BUILD_ID ?? "dev"}`;
}

// Stato locale dell'allenamento (ADR 0004), ricerca cibo e pannello admin restano fuori dalla cache.
function isPersistableKey(queryKey: readonly unknown[]): boolean {
  if (JSON.stringify(queryKey) === JSON.stringify(gymKeys.active)) return false;
  return queryKey[0] !== "foods" && queryKey[0] !== "admin";
}

function shouldPersistQuery(query: Query): boolean {
  return query.state.status === "success" && isPersistableKey(query.queryKey);
}

// Le scritture e le cancellazioni si susseguono in ordine: una scrittura non deve sovrascrivere una cancellazione.
let queue: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task).catch(() => undefined);
  queue = next;
  return next;
}

function cancelPendingWrite(): void {
  clearTimeout(timer);
  timer = undefined;
}

async function deleteCacheFile(): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: CACHE_PATH, directory: Directory.Library });
  } catch {
    // File assente: non c'è niente da cancellare.
  }
}

async function writeCache(queryClient: QueryClient): Promise<void> {
  // Dopo logout o 401 il token è null: nessuna scrittura deve ricreare il file.
  if (getToken() === null) return;
  const state = dehydrate(queryClient, {
    shouldDehydrateQuery: shouldPersistQuery,
    shouldDehydrateMutation: () => false,
  });
  const payload: PersistedCache = { buster: cacheBuster(), savedAt: Date.now(), state };
  await Filesystem.writeFile({
    path: CACHE_PATH,
    data: JSON.stringify(payload),
    directory: Directory.Library,
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

export async function restoreQueryCache(queryClient: QueryClient): Promise<void> {
  if (!isNative()) return;
  try {
    const { data } = await Filesystem.readFile({
      path: CACHE_PATH,
      directory: Directory.Library,
      encoding: Encoding.UTF8,
    });
    const cache = JSON.parse(String(data)) as PersistedCache;
    if (cache.buster !== cacheBuster()) {
      await deleteCacheFile();
      return;
    }
    const queries = cache.state.queries.filter((query) => isPersistableKey(query.queryKey));
    hydrate(queryClient, { ...cache.state, queries });
  } catch {
    await deleteCacheFile();
  }
}

export function startQueryPersistence(queryClient: QueryClient): () => void {
  if (!isNative()) return () => undefined;

  const scheduleWrite = () => {
    cancelPendingWrite();
    timer = setTimeout(() => {
      timer = undefined;
      void enqueue(() => writeCache(queryClient));
    }, WRITE_DELAY_MS);
  };

  // Andando in background l'app può essere chiusa dal multitasking: si scrive subito.
  const onVisibilityChange = () => {
    if (document.visibilityState !== "hidden") return;
    cancelPendingWrite();
    void enqueue(() => writeCache(queryClient));
  };

  const unsubscribe = queryClient.getQueryCache().subscribe(scheduleWrite);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    cancelPendingWrite();
  };
}

// Al logout o dopo un 401 di sessione: annulla la scrittura pendente e cancella il file in coda.
export function clearPersistedQueryCache(): Promise<void> {
  if (!isNative()) return Promise.resolve();
  cancelPendingWrite();
  return enqueue(deleteCacheFile);
}

// Solo per i test: attende le scritture e le cancellazioni in coda.
export function flushQueryPersistenceForTests(): Promise<void> {
  return queue;
}
