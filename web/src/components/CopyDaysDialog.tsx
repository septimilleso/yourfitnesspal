import { useState } from "react";

import type { Meal } from "../api/queries";
import { MEALS, useCopyDays } from "../api/queries";

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Colazione",
  lunch: "Pranzo",
  dinner: "Cena",
  snack: "Spuntino",
};

interface CopyDaysDialogProps {
  /** ISO dates being copied -- either every checked day from the Week
   * action bar, or the single day whose ⋯ menu opened this dialog. */
  sourceDates: string[];
  onClose: () => void;
}

/** Bulk-copy dialog for `POST /api/diary/copy`: pick a target start date,
 * an optional meal subset (default all), append/replace mode, submit, then
 * show the response's `entries_created` summary in place of the form. */
function CopyDaysDialog({ sourceDates, onClose }: CopyDaysDialogProps) {
  const [targetStart, setTargetStart] = useState("");
  const [selectedMeals, setSelectedMeals] = useState<Meal[]>(MEALS);
  const [mode, setMode] = useState<"append" | "replace">("append");

  const copyDays = useCopyDays();

  function toggleMeal(meal: Meal) {
    setSelectedMeals((prev) =>
      prev.includes(meal) ? prev.filter((m) => m !== meal) : [...prev, meal],
    );
  }

  function handleClose() {
    copyDays.reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetStart || selectedMeals.length === 0 || copyDays.isPending) return;
    copyDays.mutate({
      source_dates: sourceDates,
      target_start: targetStart,
      meals: selectedMeals.length === MEALS.length ? null : selectedMeals,
      mode,
    });
  }

  const canSubmit = targetStart.length > 0 && selectedMeals.length > 0 && !copyDays.isPending;

  return (
    <div
      role="dialog"
      aria-label="Copia giorni"
      className="fixed inset-0 z-10 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <div className="w-full max-w-sm space-y-4 rounded-t-lg bg-white p-4 shadow-lg sm:rounded-lg">
        <h2 className="text-base font-semibold text-slate-900">
          Copia {sourceDates.length} {sourceDates.length === 1 ? "giorno" : "giorni"}
        </h2>

        {copyDays.isSuccess && copyDays.data ? (
          <>
            <p role="status" className="text-sm text-slate-700">
              Copiati {copyDays.data.entries_created}{" "}
              {copyDays.data.entries_created === 1 ? "pasto" : "pasti"} in {copyDays.data.days.length}{" "}
              {copyDays.data.days.length === 1 ? "giorno" : "giorni"}.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Chiudi
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="copy-target-start" className="block text-sm font-medium text-slate-700">
                Data di inizio
              </label>
              <input
                id="copy-target-start"
                type="date"
                value={targetStart}
                onChange={(e) => setTargetStart(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
              />
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Pasti</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {MEALS.map((meal) => (
                  <label key={meal} className="flex items-center gap-1 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={selectedMeals.includes(meal)}
                      onChange={() => toggleMeal(meal)}
                      aria-label={MEAL_LABELS[meal]}
                    />
                    {MEAL_LABELS[meal]}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Modalità</legend>
              <div className="mt-1 flex gap-4">
                <label className="flex items-center gap-1 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="copy-mode"
                    checked={mode === "append"}
                    onChange={() => setMode("append")}
                  />
                  Aggiungi
                </label>
                <label className="flex items-center gap-1 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="copy-mode"
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  />
                  Sostituisci
                </label>
              </div>
            </fieldset>

            {copyDays.isError && (
              <p role="alert" className="text-sm text-red-600">
                Errore durante la copia dei giorni.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                Copia
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default CopyDaysDialog;
