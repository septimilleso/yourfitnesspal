import type { ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";

import { ApiError } from "../api/client";
import { decideConsent, getConsent } from "../api/oauth";
import { useMe } from "../auth/AuthContext";
import { redirectTo } from "../lib/redirect";

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-app px-4"><main className="card w-full max-w-sm space-y-5 p-6">{children}</main></div>;
}

const alertClass = "rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700";

export default function ConnectPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const req = params.get("req");
  const me = useMe();
  const consent = useQuery({
    queryKey: ["oauth", "consent", req],
    queryFn: () => getConsent(req ?? ""),
    enabled: Boolean(req && me.data),
    retry: false,
  });
  const decide = useMutation({
    mutationFn: (approve: boolean) => decideConsent(req ?? "", approve),
    onSuccess: (result) => redirectTo(result.redirect_url),
  });

  if (!req) return <Shell><p role="alert" className={alertClass}>Richiesta di collegamento non valida. Riprova dal tuo assistente AI.</p></Shell>;
  if (me.isLoading) return <Shell><p className="text-slate-500">Caricamento...</p></Shell>;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (consent.isLoading) return <Shell><p className="text-slate-500">Caricamento...</p></Shell>;
  if (consent.isError || !consent.data) {
    const expired = consent.error instanceof ApiError && consent.error.status === 400;
    return <Shell><p role="alert" className={alertClass}>{expired ? "Richiesta scaduta, riprova dal tuo assistente AI." : "Impossibile caricare la richiesta di collegamento."}</p></Shell>;
  }

  const info = consent.data;
  return <Shell>
    <header className="text-center">
      <h1 className="text-xl font-bold">Collega {info.client_name}</h1>
      <p className="text-sm text-slate-500">Accesso come {info.user.display_name} (@{info.user.username})</p>
    </header>
    {info.has_permission ? <>
      <p className="text-sm text-slate-700"><strong>{info.client_name}</strong> potrà leggere e modificare il tuo diario, i tuoi alimenti e i tuoi obiettivi.</p>
      {info.redirect_host && <p className="text-xs text-slate-500">Dopo la conferma tornerai su {info.redirect_host}.</p>}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" disabled={decide.isPending} onClick={() => decide.mutate(false)}>Nega</button>
        <button type="button" className="btn-primary flex-1" disabled={decide.isPending} onClick={() => decide.mutate(true)}>Autorizza</button>
      </div>
    </> : <>
      <p role="alert" className={alertClass}>Chiedi all’amministratore di abilitare le connessioni AI per il tuo account.</p>
      <button type="button" className="btn-secondary w-full" disabled={decide.isPending} onClick={() => decide.mutate(false)}>Annulla</button>
    </>}
    {decide.isError && <p role="alert" className={alertClass}>{decide.error instanceof ApiError ? decide.error.message : "Impossibile completare l’operazione."}</p>}
  </Shell>;
}
