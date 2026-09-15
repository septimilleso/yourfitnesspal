import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useGoal, usePutGoal } from "../api/queries";
import { useHasPermission, useMe } from "../auth/AuthContext";

interface FormState {
  kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
}

const EMPTY_FORM: FormState = { kcal: "", protein_g: "", carbs_g: "", fat_g: "" };

/** The four goal fields, in the order they read on a nutrition label. Each
 * carries the accent colour its macro uses on the Day page's bars, so the
 * two screens are visibly talking about the same three numbers. */
const FIELDS: { key: keyof FormState; label: string; unit: string; color?: string }[] = [
  { key: "kcal", label: "Calorie", unit: "kcal" },
  { key: "protein_g", label: "Proteine", unit: "g", color: "#3b82f6" },
  { key: "carbs_g", label: "Carboidrati", unit: "g", color: "#f59e0b" },
  { key: "fat_g", label: "Grassi", unit: "g", color: "#a855f7" },
];

/** Settings page: the only place a goal (daily kcal/protein/carbs/fat
 * target) can actually be set from the UI. Without this form, `useGoal()`
 * always resolves to `null` in practice -- the Day page's calorie ring,
 * macro bars, and Week's per-day goal-coloring are all permanently inert
 * (IMPORTANT 1 of the final review). Pre-fills from the currently active
 * goal, if any, and calls `PUT /api/goals` on submit. */
function SettingsPage() {
  const { data: goal, isLoading } = useGoal();
  const putGoal = usePutGoal();
  const { data: me } = useMe();
  const canEditGoals = useHasPermission("goals.edit");

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (goal) {
      setForm({
        kcal: String(goal.kcal),
        protein_g: String(goal.protein_g),
        carbs_g: String(goal.carbs_g),
        fat_g: String(goal.fat_g),
      });
    }
  }, [goal]);

  function handleChange(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    putGoal.mutate(
      {
        kcal: Number(form.kcal),
        protein_g: Number(form.protein_g),
        carbs_g: Number(form.carbs_g),
        fat_g: Number(form.fat_g),
      },
      {
        onSuccess: () => setSavedAt(Date.now()),
      },
    );
  }

  return (
    <div>
      <header className="app-header">
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
          {/* Grouped-list form: one row per field, hairline-separated, with
              the unit inside the row -- so the four numbers read as one
              setting rather than four loose inputs. */}
          <div className="card divide-y divide-slate-100 overflow-hidden">
            {FIELDS.map(({ key, label, unit, color }) => (
              <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                <label
                  htmlFor={`goal-${key}`}
                  className="flex flex-1 items-center gap-2 text-[15px] font-medium text-slate-700"
                >
                  {color && (
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: color }}
                    />
                  )}
                  {label}
                </label>
                <input
                  id={`goal-${key}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  required
                  value={form[key]}
                  onChange={(e) => handleChange(key, e.target.value)}
                  disabled={!canEditGoals}
                  className="min-h-[44px] w-28 rounded-xl border border-slate-300 px-3 py-2 text-right text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <span className="w-9 shrink-0 text-sm text-slate-400">{unit}</span>
              </div>
            ))}
          </div>

          <p className="px-1 text-xs text-slate-500">
            Usati per la barra delle calorie del giorno e per i colori della settimana.
          </p>

          {!canEditGoals && <p className="px-1 text-sm text-slate-500">Gli obiettivi sono gestiti dall’amministratore.</p>}
          <button type="submit" disabled={putGoal.isPending || !canEditGoals} className="btn-primary w-full">
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
