import { NetworkError } from "../api/client";

// Nell'IPA un errore di rete si riprova sempre: il retryer va in pausa finché la rete non torna.
export const retryNative = (failureCount: number, error: Error) => error instanceof NetworkError || failureCount < 3;
