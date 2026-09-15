import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  changePassword,
  listSessions,
  regenerateRecoveryCodes,
  revokeSession,
  type Session,
} from "../api/auth";
import { useLogout, useMe } from "../auth/AuthContext";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function shortUserAgent(value: string | null) {
  if (!value) return "Dispositivo sconosciuto";
  if (/iphone|ipad/i.test(value)) return "iPhone / iPad";
  if (/android/i.test(value)) return "Android";
  if (/windows/i.test(value)) return "Windows";
  if (/macintosh|mac os/i.test(value)) return "Mac";
  if (/linux/i.test(value)) return "Linux";
  return value.length > 48 ? `${value.slice(0, 45)}…` : value;
}

function RecoveryCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copyAll() {
    await navigator.clipboard?.writeText(codes.join("\n"));
    setCopied(true);
  }
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 id="recovery-title" className="text-lg font-semibold text-slate-900">Nuovi codici di recupero</h2>
        <p className="mt-2 text-sm text-slate-600">Salvali ora: non saranno più mostrati dopo aver chiuso questa finestra.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 font-mono text-sm text-slate-800">
          {codes.map((code) => <span key={code}>{code}</span>)}
        </div>
        <div className="mt-5 flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={() => void copyAll()}>{copied ? "Copiati" : "Copia tutti"}</button>
          <button type="button" className="btn-primary flex-1" onClick={onClose}>Chiudi</button>
        </div>
      </div>
    </div>
  );
}

function AccountPage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const sessions = useQuery({ queryKey: ["auth", "sessions"], queryFn: listSessions });
  const password = useMutation({
    mutationFn: changePassword,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] }),
  });
  const recovery = useMutation({ mutationFn: regenerateRecoveryCodes });
  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] }),
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [showTotp, setShowTotp] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    if (password.isSuccess) {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordSaved(true);
    }
  }, [password.isSuccess]);

  function submitPassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordSaved(false);
    password.mutate({ current_password: currentPassword, new_password: newPassword });
  }

  function submitRecovery(event: React.FormEvent) {
    event.preventDefault();
    recovery.mutate(totpCode, { onSuccess: (result) => { setCodes(result.recovery_codes); setShowTotp(false); setTotpCode(""); } });
  }

  return (
    <div>
      <header className="app-header"><div className="mx-auto max-w-2xl px-4 py-3"><h1 className="text-[17px] font-semibold text-slate-900">Account</h1></div></header>
      <main className="mx-auto max-w-2xl space-y-6 p-4">
        <section className="space-y-2"><h2 className="section-label">Profilo</h2><div className="card divide-y divide-slate-100">
          <div className="row justify-between"><span className="text-sm text-slate-500">Nome</span><span className="font-medium">{me?.display_name}</span></div>
          <div className="row justify-between"><span className="text-sm text-slate-500">Username</span><span className="font-medium">{me?.username}</span></div>
          <div className="row justify-between"><span className="text-sm text-slate-500">Ruolo</span><span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold capitalize text-brand-700">{me?.role}</span></div>
        </div></section>

        <section className="space-y-2"><h2 className="section-label">Sicurezza</h2><div className="card p-4">
          <h3 className="font-semibold">Cambia password</h3>
          <form onSubmit={submitPassword} className="mt-3 space-y-3">
            <input className="field" type="password" autoComplete="current-password" placeholder="Password attuale" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <input className="field" type="password" autoComplete="new-password" placeholder="Nuova password (12–128 caratteri)" minLength={12} maxLength={128} required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <input className="field" type="password" autoComplete="new-password" placeholder="Conferma nuova password" minLength={12} maxLength={128} required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            {confirmPassword && newPassword !== confirmPassword && <p role="alert" className="text-sm text-red-700">Le password non coincidono.</p>}
            <button className="btn-primary w-full" type="submit" disabled={password.isPending || newPassword !== confirmPassword}>Aggiorna password</button>
            {passwordSaved && <p role="status" className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">Password aggiornata. Le altre sessioni sono state disconnesse.</p>}
            {password.isError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(password.error, "Impossibile aggiornare la password.")}</p>}
          </form>
          <div className="mt-6 border-t border-slate-100 pt-4"><h3 className="font-semibold">Codici di recupero</h3><p className="mt-1 text-sm text-slate-500">Rigenerare i codici invalida quelli precedenti.</p>
            {!showTotp ? <button type="button" className="btn-secondary mt-3 w-full" onClick={() => setShowTotp(true)}>Rigenera codici</button> : <form onSubmit={submitRecovery} className="mt-3 space-y-3"><input className="field" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="Codice TOTP" required value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))} /><div className="flex gap-2"><button type="button" className="btn-ghost flex-1" onClick={() => setShowTotp(false)}>Annulla</button><button type="submit" className="btn-primary flex-1" disabled={recovery.isPending}>Conferma</button></div>{recovery.isError && <p role="alert" className="text-sm text-red-700">{errorMessage(recovery.error, "Codice non valido.")}</p>}</form>}
          </div>
        </div></section>

        <section className="space-y-2"><h2 className="section-label">Sessioni attive</h2><div className="card divide-y divide-slate-100 overflow-hidden">{sessions.isLoading && <p className="p-4 text-sm text-slate-500">Caricamento...</p>}{sessions.isError && <p role="alert" className="p-4 text-sm text-red-700">Impossibile caricare le sessioni.</p>}{sessions.data?.map((session: Session) => <div className="flex items-center gap-3 p-4" key={session.id}><div className="min-w-0 flex-1"><p className="truncate font-medium text-slate-800">{shortUserAgent(session.user_agent)}</p><p className="text-xs text-slate-500">Ultimo accesso: {formatDate(session.last_seen_at)}</p></div>{session.current ? <span className="shrink-0 rounded-full bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700">Questa sessione</span> : <button type="button" className="btn-ghost shrink-0 text-sm" onClick={() => revoke.mutate(session.id)} disabled={revoke.isPending}>Disconnetti</button>}</div>)}</div></section>
        <button type="button" className="btn-secondary w-full text-red-700" onClick={() => void logout()}>Esci</button>
      </main>
      {codes && <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />}
    </div>
  );
}

export default AccountPage;
