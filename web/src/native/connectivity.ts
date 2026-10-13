import { onlineManager } from "@tanstack/react-query";

import { isNative } from "./platform";

// Stato di rete dell'IPA. Lo aggiornano il client HTTP con gli esiti reali delle richieste
// e il timer di ripresa; lo legge la barra offline. Nel browser e nella PWA non viene usato.
const RECOVERY_INTERVAL_MS = 20000;

let offline = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function isOffline(): boolean {
  return offline;
}

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportNetworkFailure(): void {
  const changed = !offline;
  offline = true;
  onlineManager.setOnline(false);
  if (changed) notify();
}

export function reportNetworkSuccess(): void {
  const changed = offline;
  offline = false;
  onlineManager.setOnline(true);
  if (changed) notify();
}

// Porta React Query online: le query in pausa ripartono. Se la rete manca ancora, il client rimette tutto offline.
export function retryConnection(): void {
  onlineManager.setOnline(true);
}

export function startConnectivityRecovery(): () => void {
  if (!isNative()) return () => undefined;

  const interval = setInterval(() => {
    if (isOffline()) retryConnection();
  }, RECOVERY_INTERVAL_MS);

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible" && isOffline()) retryConnection();
  };
  const onOnline = () => retryConnection();
  // Con l'app in primo piano WKWebView può emettere `offline` senza che nessuna fetch fallisca.
  const onOffline = () => reportNetworkFailure();

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

// Solo per i test: riporta il modulo allo stato iniziale.
export function resetConnectivityForTests(): void {
  offline = false;
  listeners.clear();
  onlineManager.setOnline(true);
}
