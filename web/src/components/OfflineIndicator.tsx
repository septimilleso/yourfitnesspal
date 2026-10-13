import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { offlineTimeParts } from "../lib/offlineTime";
import { isOffline, subscribeConnectivity } from "../native/connectivity";
import { isNative } from "../native/platform";

const BUBBLE_MS = 4000;

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

function shownText(updatedAt: number, now: Date): string {
  const { time, day } = offlineTimeParts(updatedAt, now);
  if (day === null) return `Offline, dati delle ${time}`;
  return `Offline, dati del ${day} alle ${time}`;
}

interface OfflineIndicatorProps {
  /** Posizionamento dell'elemento nell'header del chiamante. Il puntino non è mai fixed. */
  className?: string;
}

function NativeOfflineIndicator({ className }: OfflineIndicatorProps) {
  const queryClient = useQueryClient();
  const offline = useSyncExternalStore(subscribeConnectivity, isOffline);
  const subscribeQueries = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const shownAt = useSyncExternalStore(subscribeQueries, () => oldestShownUpdatedAt(queryClient));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), BUBBLE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!offline || shownAt === null) return null;

  const text = shownText(shownAt, new Date());

  return (
    <span className={className ?? "relative inline-flex"}>
      <button
        type="button"
        aria-label={text}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-7 items-center justify-center"
      >
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-amber-500" />
      </button>
      {open && (
        <span
          role="status"
          className="absolute right-1/2 top-full z-50 translate-x-1/2 whitespace-nowrap rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-900 shadow"
        >
          {text}
        </span>
      )}
    </span>
  );
}

/** Puntino offline dell'IPA, da mettere negli header. Nel browser e nella PWA non rende nulla e non registra nulla. */
export default function OfflineIndicator({ className }: OfflineIndicatorProps) {
  if (!isNative()) return null;
  return <NativeOfflineIndicator className={className} />;
}
