import { useEffect, useState } from "react";

import { useSaveWeight, useTodayWeight } from "../api/weights";
import type { AppMode } from "../lib/appMode";
import { formatKg, parseDecimal } from "../lib/gym";
import { pattern, weightScene } from "../lib/art";

function WeightOverlay({ mode, onClose }: { mode: AppMode; onClose: () => void }) {
  const { data: todayWeight } = useTodayWeight(true);
  const saveWeight = useSaveWeight();
  const [value, setValue] = useState("");
  const [edited, setEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!edited && todayWeight) setValue(formatKg(todayWeight.weight_kg));
  }, [edited, todayWeight]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(onClose, 1000);
    return () => window.clearTimeout(timeout);
  }, [saved, onClose]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveWeight.isPending || submitting || saved) return;
    const weight = parseDecimal(value);
    if (weight === null || weight < 20 || weight > 400) {
      setError("Inserisci un peso tra 20 e 400 kg");
      return;
    }

    setError(null);
    setSubmitting(true);
    saveWeight.mutate(weight, {
      onSuccess: () => setSaved(true),
      onError: () => {
        setSubmitting(false);
        setError("Impossibile salvare il peso. Riprova.");
      },
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Registra peso" className="fixed inset-0 z-50 overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${pattern(mode)}")` }}
        />
        <div
          data-testid="weight-scene"
          className="settings-scene absolute inset-0 bg-cover bg-bottom bg-no-repeat"
          style={{ backgroundImage: `url("${weightScene(mode)}")` }}
        />
      </div>
      <div className="relative z-10 flex h-full items-start justify-center overflow-y-auto px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <form
          onSubmit={submit}
          className="w-full max-w-sm rounded-2xl border border-white/70 bg-[#fffaf0]/95 p-5 shadow-xl backdrop-blur-sm"
        >
          <label htmlFor="weight-kg" className="mb-2 block text-sm font-semibold text-slate-800">
            Peso in kg
          </label>
          <input
            id="weight-kg"
            type="text"
            inputMode="decimal"
            aria-label="Peso in kg"
            autoFocus
            value={value}
            onChange={(event) => {
              setEdited(true);
              setValue(event.target.value);
              setError(null);
            }}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
          />
          {error && (
            <p role="alert" className="mt-2 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="mt-2 text-sm font-medium text-emerald-800">
              Peso salvato
            </p>
          )}
          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={saveWeight.isPending || submitting || saved}
              className="flex-1 rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              Salva
            </button>
            <button
              type="button"
              aria-label="Chiudi"
              onClick={onClose}
              className="rounded-xl border border-slate-300 bg-white/90 px-4 py-3 font-semibold text-slate-800 transition active:scale-[0.98]"
            >
              Chiudi
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default WeightOverlay;
