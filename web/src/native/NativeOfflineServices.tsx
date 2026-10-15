import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { startConnectivityRecovery } from "./connectivity";
import { startGymSync } from "./gymSync";
import { isNative } from "./platform";
import { startPrefetch } from "./prefetchScheduler";
import { getToken } from "./session";

/** Avvia nell'IPA la ripresa della connessione, il precarico e il sync della palestra, anche nelle pagine senza puntino. Nel browser non rende nulla e non registra nulla. */
export default function NativeOfflineServices() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isNative()) return;
    const stopRecovery = startConnectivityRecovery();
    const stopPrefetch = startPrefetch(queryClient);
    const stopGymSync = startGymSync(queryClient);
    // Una `["me"]` restaurata dalla cache può essere ancora fresca: senza una risposta nuova il sync non può confermare
    // l'utente (R21), quindi se c'è una sessione se ne chiede una.
    if (getToken() !== null) void queryClient.invalidateQueries({ queryKey: ["me"], exact: true });
    return () => {
      stopRecovery();
      stopPrefetch();
      stopGymSync();
    };
  }, [queryClient]);

  return null;
}
