import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { isOffline, startConnectivityRecovery, subscribeConnectivity } from "../native/connectivity";
import { isNative } from "../native/platform";

// La query ["me"] è sempre osservata da AuthProvider, quindi la sua età non dice cosa è in vista.
function isMeQuery(queryKey: readonly unknown[]): boolean {
  return queryKey.length === 1 && queryKey[0] === "me";
}

// Ora più vecchia tra le query in vista che hanno dati, ["me"] esclusa se ce ne sono altre.
// Restituisce un numero, quindi lo snapshot è stabile.
function oldestShownUpdatedAt(queryClient: QueryClient): number | null {
  let oldest: number | null = null;
  let oldestMe: number | null = null;
  for (const query of queryClient.getQueryCache().getAll()) {
    const { data, dataUpdatedAt } = query.state;
    if (query.getObserversCount() === 0 || data === undefined || dataUpdatedAt <= 0) continue;
    if (isMeQuery(query.queryKey)) {
      oldestMe = dataUpdatedAt;
    } else if (oldest === null || dataUpdatedAt < oldest) {
      oldest = dataUpdatedAt;
    }
  }
  return oldest ?? oldestMe;
}

function formatShownAt(updatedAt: number, now: Date): string {
  const shown = new Date(updatedAt);
  const time = shown.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (shown.toDateString() === now.toDateString()) return `Offline, dati delle ${time}`;
  const day = shown.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
  return `Offline, dati del ${day} alle ${time}`;
}

function NativeOfflineBar() {
  const queryClient = useQueryClient();
  const offline = useSyncExternalStore(subscribeConnectivity, isOffline);
  const subscribeQueries = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const shownAt = useSyncExternalStore(subscribeQueries, () => oldestShownUpdatedAt(queryClient));

  useEffect(() => startConnectivityRecovery(), []);

  if (!offline || shownAt === null) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-amber-100 px-4 pb-1 text-center text-xs text-amber-900"
      style={{ paddingTop: "var(--safe-top)" }}
    >
      {formatShownAt(shownAt, new Date())}
    </div>
  );
}

/** Barra "Offline, dati delle ..." dell'IPA. Nel browser e nella PWA non rende nulla e non registra nulla. */
export default function OfflineBar() {
  if (!isNative()) return null;
  return <NativeOfflineBar />;
}
