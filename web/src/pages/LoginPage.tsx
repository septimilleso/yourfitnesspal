import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import { login, setupComplete, setupStart, verifyTotp, type SetupStartResponse } from "../api/auth";
import { clearClientCaches } from "../auth/AuthContext";
import { safeNext } from "../lib/safeNext";
import { scene } from "../lib/art";

type Step = "credentials" | "totp" | "setup" | "recovery";

function errorMessage(error: unknown) {
  return error instanceof ApiError ? error.message : "Impossibile completare l’operazione.";
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mustChange, setMustChange] = useState(false);
  const [setup, setSetup] = useState<SetupStartResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (step !== "setup") return;
    void setupStart().then(setSetup).catch((err) => setError(errorMessage(err)));
  }, [step]);

  const finish = async () => {
    await clearClientCaches(queryClient);
    navigate(safeNext(searchParams.get("next")) ?? "/", { replace: true });
  };

  async function credentials(event: FormEvent) {
    event.preventDefault(); setError(null); setSubmitting(true);
    try {
      const result = await login(username, password);
      setMustChange(Boolean(result.must_change_password));
      setStep(result.status === "setup_required" ? "setup" : "totp");
    } catch (err) { setError(errorMessage(err)); } finally { setSubmitting(false); }
  }

  async function totp(event: FormEvent) {
    event.preventDefault(); setError(null); setSubmitting(true);
    try { await verifyTotp(step === "recovery" ? { recovery_code: code } : { code }); await finish(); }
    catch (err) {
      if (err instanceof ApiError && err.status === 401 && /challenge/i.test(err.message)) setStep("credentials");
      setError(errorMessage(err));
    } finally { setSubmitting(false); }
  }

  async function completeSetup(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (mustChange && (newPassword.length < 12 || newPassword !== confirmPassword)) {
      setError("La password deve avere almeno 12 caratteri e coincidere con la conferma."); return;
    }
    setSubmitting(true);
    try {
      const result = await setupComplete({ code, ...(mustChange ? { new_password: newPassword } : {}) });
      setRecoveryCodes(result.recovery_codes); setStep("recovery");
    } catch (err) { setError(errorMessage(err)); } finally { setSubmitting(false); }
  }

  const alert = error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  return <div className="flex min-h-screen items-start justify-center bg-app bg-cover bg-bottom bg-no-repeat px-4 pt-8" style={{ backgroundImage: `url("${scene("diet")}")` }}><main className="card w-full max-w-sm space-y-5 bg-white/90 p-6 backdrop-blur-sm">
    <header className="text-center"><h1 className="text-2xl font-bold">YourFitnessPal</h1><p className="text-sm text-slate-500">Accesso sicuro al tuo account</p></header>
    {step === "credentials" && <form className="space-y-4" onSubmit={credentials}>
      <label className="field-label">Username<input className="field mt-1" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
      <label className="field-label">Password<input className="field mt-1" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{alert}
      <button className="btn-primary w-full" disabled={submitting}>{submitting ? "Accesso..." : "Accedi"}</button>
    </form>}
    {(step === "totp" || (step === "recovery" && recoveryCodes.length === 0)) && <form className="space-y-4" onSubmit={totp}>
      <label className="field-label">Codice autenticatore<input className="field mt-1" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} required /></label>{alert}
      <button className="btn-primary w-full" disabled={submitting}>Verifica</button><button type="button" className="text-sm text-brand-600" onClick={() => { setStep("recovery"); setCode(""); }}>Usa un codice di recupero</button>
    </form>}
    {step === "setup" && <form className="space-y-4" onSubmit={completeSetup}>
      <p className="text-sm">Configura l’autenticatore scansionando il QR code.</p>{setup && <><img src={setup.qr_svg_data_uri} alt="QR code per l'app di autenticazione" className="mx-auto w-48" /><code className="block break-all text-xs">{setup.secret}</code></>}
      {mustChange && <><label className="field-label">Nuova password<input className="field mt-1" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label><label className="field-label">Conferma password<input className="field mt-1" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></label></>}
      <label className="field-label">Codice<input className="field mt-1" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required /></label>{alert}<button className="btn-primary w-full" disabled={submitting || !setup}>Completa configurazione</button>
    </form>}
    {step === "recovery" && recoveryCodes.length > 0 && <section className="space-y-4"><p className="text-sm">Salva questi codici: non verranno più mostrati.</p><pre className="rounded bg-slate-100 p-3 text-xs">{recoveryCodes.join("\n")}</pre><label className="flex gap-2 text-sm"><input type="checkbox" checked={savedCodes} onChange={(e) => setSavedCodes(e.target.checked)} />Ho salvato i codici in un posto sicuro</label><button className="btn-primary w-full" disabled={!savedCodes} onClick={() => void finish()}>Continua</button></section>}
    {step === "recovery" && recoveryCodes.length === 0 && <form className="space-y-4" onSubmit={totp}><label className="field-label">Codice di recupero<input className="field mt-1" value={code} onChange={(e) => setCode(e.target.value)} required /></label>{alert}<button className="btn-primary w-full" disabled={submitting}>Verifica</button></form>}
  </main></div>;
}
