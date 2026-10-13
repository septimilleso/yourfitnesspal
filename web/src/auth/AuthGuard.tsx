import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { retryConnection } from "../native/connectivity";
import { isNative } from "../native/platform";
import { getToken } from "../native/session";
import { useMe } from "./AuthContext";

function Loading() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-slate-500">Loading...</p></div>;
}

function Unreachable({ onRetry }: { onRetry: () => void }) {
  return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><p>Impossibile contattare il server</p><button className="btn-primary" onClick={onRetry}>Riprova</button></div>;
}

// Nell'IPA la sessione è finita: la cache in memoria va svuotata, altrimenti un nuovo login
// riscriverebbe su file i dati dell'account precedente. L'effetto gira una sola volta, al montaggio.
function SessionEnded() {
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.clear();
  }, [queryClient]);
  return <Navigate to="/login" replace />;
}

function NativeGuard({ query }: { query: ReturnType<typeof useMe> }) {
  if (getToken() === null) return <SessionEnded />;
  if (query.error instanceof ApiError && query.error.status === 401) return <SessionEnded />;
  if (query.data) return <Outlet />;
  if (query.isLoading) return <Loading />;
  if (query.error || query.fetchStatus === "paused") {
    return <Unreachable onRetry={() => { retryConnection(); void query.refetch(); }} />;
  }
  return <SessionEnded />;
}

export default function AuthGuard() {
  const query = useMe();
  if (isNative()) return <NativeGuard query={query} />;
  if (query.isLoading) return <Loading />;
  if (query.error) {
    if (query.error instanceof ApiError && query.error.status === 401) return <Navigate to="/login" replace />;
    return <Unreachable onRetry={() => void query.refetch()} />;
  }
  return query.data ? <Outlet /> : <Navigate to="/login" replace />;
}
