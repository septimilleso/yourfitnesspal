import { useEffect } from "react";

import { startConnectivityRecovery } from "./connectivity";
import { isNative } from "./platform";

/** Avvia nell'IPA la ripresa della connessione, anche nelle pagine senza puntino. Nel browser non rende nulla e non registra nulla. */
export default function NativeOfflineServices() {
  useEffect(() => {
    if (!isNative()) return;
    return startConnectivityRecovery();
  }, []);

  return null;
}
