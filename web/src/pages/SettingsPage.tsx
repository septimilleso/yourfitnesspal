import { useEffect, useState } from "react";

import { useGoal, usePutGoal } from "../api/queries";

interface FormState {
  kcal: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
}

const EMPTY_FORM: FormState = { kcal: "", protein_g: "", carbs_g: "", fat_g: "" };

/** Settings page: the only place a goal (daily kcal/protein/carbs/fat
 * target) can actually be set from the UI. Without this form, `useGoal()`
 * always resolves to `null` in practice -- the Day page's calorie ring,
 * macro bars, and Week's per-day goal-coloring are all permanently inert
 * (IMPORTANT 1 of the final review). Pre-fills from the currently active
 * goal, if any, and calls `PUT /api/goals` on submit. */
function SettingsPage() {
  const { data: goal, isLoading } = useGoal();
  const putGoal = usePutGoal();

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
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header>
        <h1 className="text-lg font-bold text-slate-900">Obiettivi giornalieri</h1>
      </header>

      {isLoading && <p className="text-center text-slate-500">Caricamento...</p>}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg bg-white p-4 shadow-sm">
        <div>
          <label htmlFor="goal-kcal" className="block text-sm font-medium text-slate-700">
            Calorie (kcal)
          </label>
          <input
            id="goal-kcal"
            type="number"
            required
            value={form.kcal}
            onChange={(e) => handleChange("kcal", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="goal-protein" className="block text-sm font-medium text-slate-700">
            Proteine (g)
          </label>
          <input
            id="goal-protein"
            type="number"
            required
            value={form.protein_g}
            onChange={(e) => handleChange("protein_g", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="goal-carbs" className="block text-sm font-medium text-slate-700">
            Carboidrati (g)
          </label>
          <input
            id="goal-carbs"
            type="number"
            required
            value={form.carbs_g}
            onChange={(e) => handleChange("carbs_g", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="goal-fat" className="block text-sm font-medium text-slate-700">
            Grassi (g)
          </label>
          <input
            id="goal-fat"
            type="number"
            required
            value={form.fat_g}
            onChange={(e) => handleChange("fat_g", e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          disabled={putGoal.isPending}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {putGoal.isPending ? "Salvataggio..." : "Salva obiettivo"}
        </button>

        {savedAt !== null && (
          <p role="status" className="text-sm text-green-600">
            Obiettivo salvato.
          </p>
        )}
        {putGoal.isError && (
          <p role="alert" className="text-sm text-red-600">
            Errore nel salvataggio dell&apos;obiettivo.
          </p>
        )}
      </form>
    </div>
  );
}

export default SettingsPage;
