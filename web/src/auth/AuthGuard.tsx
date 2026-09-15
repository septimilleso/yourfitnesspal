import { Navigate, Outlet } from "react-router-dom";
import { ApiError } from "../api/client";
import { useMe } from "./AuthContext";

function Loading() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50"><p className="text-slate-500">Loading...</p></div>;
}

export default function AuthGuard() {
  const query = useMe();
  if (query.isLoading) return <Loading />;
  if (query.error) {
    if (query.error instanceof ApiError && query.error.status === 401) return <Navigate to="/login" replace />;
    return <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"><p>Impossibile contattare il server</p><button className="btn-primary" onClick={() => void query.refetch()}>Riprova</button></div>;
  }
  return query.data ? <Outlet /> : <Navigate to="/login" replace />;
}
