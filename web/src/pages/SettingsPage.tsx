import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useGoal, usePutGoal } from "../api/queries";
import { useHasPermission, useMe } from "../auth/AuthContext";
import ModeSwitch from "../components/ModeSwitch";
import { calculateMacroGrams, normalizeMacroPercentages } from "../lib/goalMath";

interface FormState {
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
}

type MacroKey = "protein" | "carbs" | "fat";

const EMPTY_FORM: FormState = { kcal: "", protein: "", carbs: "", fat: "" };

const MACROS: { key: MacroKey; gramsKey: "protein_g" | "carbs_g" | "fat_g"; label: string; color: string }[] = [
  { key: "protein", gramsKey: "protein_g", label: "Proteine", color: "#3b82f6" },
  { key: "carbs", gramsKey: "carbs_g", label: "Carboidrati", color: "#f59e0b" },
  { key: "fat", gramsKey: "fat_g", label: "Grassi", color: "#a855f7" },
];

function parsePercentage(value: string): number | null {
  if (!value.trim()) return null;
  const percentage = Number(value);
  return Number.isInteger(percentage) && percentage >= 0 && percentage <= 100 ? percentage : null;
}

/** Settings page: daily calorie and macro goals, persisted as grams by the API. */
function SettingsPage() {
  const { data: goal, isLoading } = useGoal();
  const putGoal = usePutGoal();
  const { data: me } = useMe();
  const canEditGoals = useHasPermission("goals.edit");

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!goal) {
      setForm(EMPTY_FORM);
      return;
    }

    const percentages = normalizeMacroPercentages(goal);
    setForm({
      kcal: String(goal.kcal),
      protein: percentages.protein === null ? "" : String(percentages.protein),
      carbs: percentages.carbs === null ? "" : String(percentages.carbs),
      fat: percentages.fat === null ? "" : String(percentages.fat),
    });
  }, [goal]);

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const parsedPercentages = {
    protein: parsePercentage(form.protein),
    carbs: parsePercentage(form.carbs),
    fat: parsePercentage(form.fat),
  };
  const percentagesComplete = Object.values(parsedPercentages).every((value) => value !== null);
  const percentageTotal = Object.values(parsedPercentages).reduce<number>(
    (total, value) => total + (value ?? 0),
    0,
  );
  const percentagesAreValid = percentagesComplete && percentageTotal === 100;
  const kcal = Number(form.kcal);
  const kcalIsValid = form.kcal.trim() !== "" && Number.isFinite(kcal) && kcal >= 0;
  const isFormValid = kcalIsValid && percentagesAreValid;
  const gramPreview = calculateMacroGrams(kcalIsValid ? kcal : 0, {
    protein: parsedPercentages.protein ?? 0,
    carbs: parsedPercentages.carbs ?? 0,
    fat: parsedPercentages.fat ?? 0,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormValid || !canEditGoals) return;

    const grams = calculateMacroGrams(kcal, {
      protein: parsedPercentages.protein!,
      carbs: parsedPercentages.carbs!,
      fat: parsedPercentages.fat!,
    });
    putGoal.mutate(
      { kcal, ...grams },
      {
        onSuccess: () => setSavedAt(Date.now()),
      },
    );
  }

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-[17px] font-semibold text-slate-900">Impostazioni</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}

        <section className="card divide-y divide-slate-100 overflow-hidden">
          <Link className="row flex justify-between" to="/account"><span>Account</span><span className="text-slate-500">{me?.username} ›</span></Link>
          {me?.role === "admin" && <Link className="row flex justify-between" to="/admin/users"><span>Gestione utenti</span><span>›</span></Link>}
        </section>

        <h2 className="section-label">Obiettivi giornalieri</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="card divide-y divide-slate-100 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5">
              <label
                htmlFor="goal-kcal"
                className="flex flex-1 items-center gap-2 text-[15px] font-medium text-slate-700"
              >
                Calorie
              </label>
              <input
                id="goal-kcal"
                type="number"
                inputMode="numeric"
                min="0"
                required
                value={form.kcal}
                onChange={(e) => handleChange("kcal", e.target.value)}
                disabled={!canEditGoals}
                className="min-h-[44px] w-28 rounded-xl border border-slate-300 px-3 py-2 text-right text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <span className="w-9 shrink-0 text-sm text-slate-400">kcal</span>
            </div>

            {MACROS.map(({ key, gramsKey, label, color }) => (
              <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={`goal-${key}`}
                    className="flex items-center gap-2 text-[15px] font-medium text-slate-700"
                  >
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                    {label}
                  </label>
                  <p className="pl-[18px] pt-0.5 text-sm text-slate-400">{gramPreview[gramsKey]} g</p>
                </div>
                <input
                  id={`goal-${key}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="100"
                  step="1"
                  required
                  value={form[key]}
                  onChange={(e) => handleChange(key, e.target.value)}
                  disabled={!canEditGoals}
                  className="min-h-[44px] w-28 rounded-xl border border-slate-300 px-3 py-2 text-right text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <span className="w-9 shrink-0 text-sm text-slate-400">%</span>
              </div>
            ))}
          </div>

          {!percentagesAreValid && (
            <p role="alert" className="px-1 text-sm text-red-600">
              La somma delle percentuali deve essere 100% (attuale: {percentageTotal}%).
            </p>
          )}

          <p className="px-1 text-xs text-slate-500">
            Usati per la barra delle calorie del giorno e per i colori della settimana.
          </p>

          {!canEditGoals && <p className="px-1 text-sm text-slate-500">Gli obiettivi sono gestiti dall’amministratore.</p>}
          <button type="submit" disabled={putGoal.isPending || !canEditGoals || !isFormValid} className="btn-primary w-full">
            {putGoal.isPending ? "Salvataggio..." : "Salva obiettivo"}
          </button>

          {savedAt !== null && (
            <p
              role="status"
              className="rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700"
            >
              Obiettivo salvato.
            </p>
          )}
          {putGoal.isError && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              Errore nel salvataggio dell&apos;obiettivo.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

export default SettingsPage;
