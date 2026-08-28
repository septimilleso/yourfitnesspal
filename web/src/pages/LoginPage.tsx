import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ApiError, login } from "../api/client";

function LoginPage() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(key);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-app px-4"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
    >
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-5 p-6">
        <div className="space-y-1 text-center">
          <div
            aria-hidden
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl"
          >
            🥗
          </div>
          <h1 className="pt-2 text-2xl font-bold tracking-tight text-slate-900">YourFitnessPal</h1>
          <p className="text-sm text-slate-500">Inserisci la chiave di accesso.</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="app-key" className="field-label">
            Key
          </label>
          <input
            id="app-key"
            name="key"
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className="field"
            required
          />
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary w-full">
          {submitting ? "Logging in..." : "Log in"}
        </button>
      </form>
    </div>
  );
}

export default LoginPage;
