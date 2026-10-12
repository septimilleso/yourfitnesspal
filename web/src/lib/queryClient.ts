import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiError, NetworkError } from "../api/client";
import { isNative } from "../native/platform";

// Nell'IPA un errore di rete si riprova sempre: il retryer va in pausa finché la rete non torna.
export const retryNative = (failureCount: number, error: Error) => error instanceof NetworkError || failureCount < 3;

// Per le query che devono ripartire solo con la rete, come `["me"]`.
export const retryOnlyNetwork = (_failureCount: number, error: Error) => error instanceof NetworkError;

export function createQueryClient(native: boolean): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== "me") {
          queryClient.setQueryData(["me"], null);
          void queryClient.invalidateQueries({ queryKey: ["me"] });
        }
      },
    }),
    mutationCache: new MutationCache({ onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(["me"], null);
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    } }),
    ...(native
      ? {
          defaultOptions: {
            // Senza gcTime infinito le query non osservate uscirebbero dalla cache prima di essere persistite.
            queries: { gcTime: Infinity, retry: retryNative },
            // Con "always" una mutazione offline fallisce subito con NetworkError invece di restare in pausa.
            mutations: { networkMode: "always" },
          },
        }
      : {}),
  });
  return queryClient;
}

export const queryClient = createQueryClient(isNative());
