/** Query in pausa senza dati: è quello che un hook restituisce offline quando la pagina non ha cache. */
export function pausedQuery() {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    fetchStatus: "paused",
    status: "pending",
  };
}

/** Stessa query, di nuovo in fetching durante un tentativo di ripresa. */
export function retryingQuery() {
  return { ...pausedQuery(), isLoading: true, fetchStatus: "fetching" };
}
