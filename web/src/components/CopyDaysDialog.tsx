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
 * show the response's `entries_created` summary in place of the form.
 *
 * Same iOS bottom-sheet presentation as `QuantityPicker` (grabber, slides
 * up from the bottom edge on a phone, footer padded past the home
 * indicator). */
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet">
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="border-b border-slate-100 px-5 pb-3 pt-3">
          <h2 className="text-[17px] font-semibold text-slate-900">
            Copia {sourceDates.length} {sourceDates.length === 1 ? "giorno" : "giorni"}
          </h2>
          <p className="truncate text-[13px] text-slate-500">{sourceDates.join(", ")}</p>
        </div>

        {copyDays.isSuccess && copyDays.data ? (
          <>
            <p role="status" className="px-5 py-6 text-center text-sm text-slate-700">
              Copiati {copyDays.data.entries_created}{" "}
              {copyDays.data.entries_created === 1 ? "pasto" : "pasti"} in {copyDays.data.days.length}{" "}
              {copyDays.data.days.length === 1 ? "giorno" : "giorni"}.
            </p>
            <div className="border-t border-slate-100 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
              <button type="button" onClick={handleClose} className="btn-primary w-full">
                Chiudi
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="space-y-5 px-5 py-4">
              <div>
                <label htmlFor="copy-target-start" className="field-label">
                  Data di inizio
                </label>
                <input
                  id="copy-target-start"
                  type="date"
                  value={targetStart}
                  onChange={(e) => setTargetStart(e.target.value)}
                  className="field mt-1.5"
                />
              </div>

              <fieldset>
                <legend className="field-label">Pasti</legend>
                {/* Checkbox rows in a bordered group with hairlines between
                    them -- inline checkboxes on one line were impossible to
                    hit accurately on a phone. */}
                <div className="mt-1.5 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                  {MEALS.map((meal) => (
                    <label
                      key={meal}
                      className="flex min-h-[44px] items-center gap-3 px-3 text-[15px] text-slate-700"
                    >
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
                <legend className="field-label">Modalità</legend>
                <div className="mt-1.5 space-y-2">
                  {/* "Sostituisci" wipes the target days' existing entries,
                      so it says so instead of relying on the verb alone. */}
                  <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-200 px-3 text-[15px] text-slate-700">
                    <input
                      type="radio"
                      name="copy-mode"
                      checked={mode === "append"}
                      onChange={() => setMode("append")}
                    />
                    <span>
                      Aggiungi
                      <span className="block text-[12px] text-slate-500">
                        Mantiene i pasti già presenti
                      </span>
                    </span>
                  </label>
                  <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-200 px-3 text-[15px] text-slate-700">
                    <input
                      type="radio"
                      name="copy-mode"
                      checked={mode === "replace"}
                      onChange={() => setMode("replace")}
                    />
                    <span>
                      Sostituisci
                      <span className="block text-[12px] text-slate-500">
                        Cancella i pasti già presenti
                      </span>
                    </span>
                  </label>
                </div>
              </fieldset>

              {copyDays.isError && (
                <p role="alert" className="text-sm text-red-600">
                  Errore durante la copia dei giorni.
                </p>
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-100 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
              <button type="button" onClick={handleClose} className="btn-secondary flex-1">
                Annulla
              </button>
              <button type="submit" disabled={!canSubmit} className="btn-primary flex-1">
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
