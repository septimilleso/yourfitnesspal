import { useSyncExternalStore } from "react";

import { isOffline, subscribeConnectivity } from "../native/connectivity";
import { isNative } from "../native/platform";

interface UnavailableQuery {
  data?: unknown;
  isPlaceholderData?: boolean;
  fetchStatus?: string;
}

/**
 * True nell'IPA quando la query non ha dati da mostrare, è in pausa o in ripresa e la rete manca.
 * Va chiamato sempre, anche sul web, dove restituisce false.
 */
export function useOfflineUnavailable(query: UnavailableQuery): boolean {
  // Chiamato prima dei return anticipati, per le regole degli hook. Lo snapshot è un booleano.
  const offline = useSyncExternalStore(subscribeConnectivity, isOffline);
  const noDataToShow = query.data === undefined || query.isPlaceholderData === true;
  const waiting = query.fetchStatus === "paused" || query.fetchStatus === "fetching";
  return isNative() && offline && noDataToShow && waiting;
}
