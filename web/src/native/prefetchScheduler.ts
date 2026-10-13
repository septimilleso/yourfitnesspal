import { hashKey, onlineManager, type QueryClient } from "@tanstack/react-query";

import { isOffline, subscribeConnectivity } from "./connectivity";
import { isNative } from "./platform";
import { runPrefetchRound } from "./prefetch";
import { getToken } from "./session";

// Il giro non parte più di una volta ogni 15 minuti al ritorno in primo piano o della rete (R5).
const PREFETCH_INTERVAL_MS = 15 * 60_000;
// Ripiego senza requestIdleCallback (WKWebView e jsdom): un breve ritardo dopo il primo render.
const IDLE_FALLBACK_MS = 2000;
const IDLE_TIMEOUT_MS = 5000;

const ME_KEY = ["me"];

type Phase = "idle" | "scheduled" | "running";

// Stato di modulo: vive solo in memoria, quindi un nuovo processo parte sempre con un giro.
let startedAt = 0;
let lastCompletedAt: number | null = null;
let phase: Phase = "idle";
let cancelScheduledRound: (() => void) | null = null;

// Attende l'idle del browser; se non c'è, un ritardo fisso. Restituisce la funzione di annullamento.
function scheduleIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = setTimeout(callback, IDLE_FALLBACK_MS);
  return () => clearTimeout(timer);
}

// Condizioni di R5 e R6, tranne la fase: il callback in idle le ricontrolla con la fase già "scheduled".
function canStart(queryClient: QueryClient): boolean {
  if (!isNative()) return false;
  if (getToken() === null) return false;
  if (isOffline() || !onlineManager.isOnline()) return false;
  // `["me"]` deve avere un utente e deve essere arrivata in questa esecuzione: così il giro è legato a /auth/me.
  const me = queryClient.getQueryCache().find({ queryKey: ME_KEY, exact: true });
  const user = me?.state.data;
  if (me === undefined || user === null || user === undefined) return false;
  if (me.state.dataUpdatedAt < startedAt) return false;
  if (lastCompletedAt !== null && Date.now() - lastCompletedAt < PREFETCH_INTERVAL_MS) return false;
  return true;
}

function canPrefetch(queryClient: QueryClient): boolean {
  return phase === "idle" && canStart(queryClient);
}

async function runRound(queryClient: QueryClient): Promise<void> {
  phase = "running";
  try {
    const outcome = await runPrefetchRound(queryClient);
    if (outcome === "completed") lastCompletedAt = Date.now();
  } catch {
    // Il giro non dovrebbe rifiutare; se succede, lo scheduler resta utilizzabile.
  } finally {
    phase = "idle";
  }
}

// `["me"]` ripristinata dalla cache è vecchia per questa esecuzione: se la rete e il token ci sono, se ne chiede una nuova.
// Chiamata all'avvio in idle, al ritorno della rete e al ritorno in primo piano, così una ripartenza offline non resta bloccata.
function refreshStaleMe(queryClient: QueryClient): void {
  const me = queryClient.getQueryCache().find({ queryKey: ME_KEY, exact: true });
  if (me === undefined || me.state.dataUpdatedAt >= startedAt) return;
  if (me.state.fetchStatus !== "idle" || getToken() === null) return;
  if (isOffline() || !onlineManager.isOnline()) return;
  void queryClient.invalidateQueries({ queryKey: ME_KEY, exact: true });
}

function requestPrefetch(queryClient: QueryClient): void {
  if (!canPrefetch(queryClient)) return;
  phase = "scheduled";
  cancelScheduledRound = scheduleIdle(() => {
    cancelScheduledRound = null;
    if (!canStart(queryClient)) {
      phase = "idle";
      return;
    }
    void runRound(queryClient);
  });
}

// Avvia lo scheduler del precarico. Sul web non fa nulla e non registra listener.
export function startPrefetch(queryClient: QueryClient): () => void {
  if (!isNative()) return () => undefined;

  startedAt = Date.now();

  const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (hashKey(event.query.queryKey) !== hashKey(ME_KEY)) return;
    requestPrefetch(queryClient);
  });

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    refreshStaleMe(queryClient);
    requestPrefetch(queryClient);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const unsubscribeConnectivity = subscribeConnectivity(() => {
    if (isOffline()) return;
    refreshStaleMe(queryClient);
    requestPrefetch(queryClient);
  });

  const cancelFreshCheck = scheduleIdle(() => refreshStaleMe(queryClient));

  requestPrefetch(queryClient);

  return () => {
    unsubscribeCache();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unsubscribeConnectivity();
    cancelFreshCheck();
    if (phase === "scheduled") {
      cancelScheduledRound?.();
      cancelScheduledRound = null;
      phase = "idle";
    }
  };
}

// Solo per i test: riporta il modulo allo stato iniziale.
export function resetPrefetchSchedulerForTests(): void {
  cancelScheduledRound?.();
  cancelScheduledRound = null;
  startedAt = 0;
  lastCompletedAt = null;
  phase = "idle";
}
