import type { QueryClient } from "@tanstack/react-query";

import { isNative } from "./platform";
import { clearPersistedQueryCache, restoreQueryCache, startQueryPersistence } from "./queryPersistence";
import { getToken, loadNativeSession } from "./session";

// Prima del primo render: carica la sessione, ripristina la cache solo con un token, poi avvia le scritture.
// L'ordine conta: startQueryPersistence va dopo il ripristino, così il ripristino non riscrive il file mentre finisce.
// Ogni passo è isolato: un errore non blocca il render.
export async function prepareNativeSession(queryClient: QueryClient): Promise<void> {
  try {
    await loadNativeSession();
  } catch {
    // Senza sessione letta il token resta null e si mostra il login.
  }

  if (isNative()) {
    try {
      // Un file di cache senza sessione non deve restare sul dispositivo.
      if (getToken() !== null) await restoreQueryCache(queryClient);
      else await clearPersistedQueryCache();
    } catch {
      // Nessun dato in cache: si parte come prima di questa feature.
    }
  }

  try {
    startQueryPersistence(queryClient);
  } catch {
    // Senza scritture la cache non si aggiorna, ma l'app parte.
  }
}
