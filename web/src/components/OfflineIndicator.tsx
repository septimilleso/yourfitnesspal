import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { offlineTimeParts } from "../lib/offlineTime";
import { isOffline, subscribeConnectivity } from "../native/connectivity";
import { getSnapshot, subscribe, syncBadgeCount } from "../native/gymStore";
import { isNative } from "../native/platform";

const BUBBLE_MS = 4000;
const SCREEN_MARGIN = 8;

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
  // Allenamenti di palestra da sincronizzare: il fumetto li riporta (R23).
  const unsynced = syncBadgeCount(useSyncExternalStore(subscribe, getSnapshot));
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [bubbleShift, setBubbleShift] = useState(0);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), BUBBLE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  // Il fumetto è centrato sul puntino: se uscirebbe dallo schermo, si sposta dentro i bordi.
  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!anchor || !bubble) {
      setBubbleShift(0);
      return;
    }
    const centered = anchor.left + anchor.width / 2 - bubble.width / 2;
    const fitted = Math.min(
      Math.max(centered, SCREEN_MARGIN),
      window.innerWidth - SCREEN_MARGIN - bubble.width,
    );
    setBubbleShift(fitted - centered);
  }, [open, offline, shownAt, unsynced]);

  if (!offline || shownAt === null) return null;

  const text =
    shownText(shownAt, new Date()) + (unsynced > 0 ? ` · ${unsynced} da sincronizzare` : "");

  return (
    <span ref={anchorRef} className={className ?? "relative inline-flex"}>
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
          ref={bubbleRef}
          role="status"
          style={{ marginLeft: bubbleShift }}
          className="absolute left-1/2 top-full z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-900 shadow"
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
