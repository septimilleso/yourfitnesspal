import { useState } from "react";

import type { DiaryEntry, Meal } from "../api/queries";
import { MEALS, usePatchEntry } from "../api/queries";
import { MEAL_LABELS } from "../lib/meals";
import { scalePreview } from "./QuantityPicker";

interface EditEntrySheetProps {
  entry: DiaryEntry;
  onClose: () => void;
}

/** Sheet di modifica di una entry già registrata: cambia i grammi e/o
 * sposta l'alimento tra i 4 pasti, con un unico PATCH.
 *
 * Modellato su `QuantityPicker` (stesso overlay, grabber, footer
 * safe-area), ma parte da valori esistenti e non ha i preset "Porzione":
 * lo snapshot dell'entry non porta `serving_size_g`. La preview macro è
 * calcolata dallo snapshot dell'entry, non da un food live. */
function EditEntrySheet({ entry, onClose }: EditEntrySheetProps) {
  const [grams, setGrams] = useState<number>(entry.grams);
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const patchEntry = usePatchEntry();

  const preview = scalePreview(entry.nutriments_snapshot, grams || 0);
  const gramsInvalid = !(grams > 0);
  const canSave = grams > 0 && !patchEntry.isPending;
  const label = entry.food_name || `Alimento #${entry.food_id}`;

  function handleSave() {
    if (!canSave) return;
    patchEntry.mutate({ id: entry.id, grams, meal }, { onSuccess: () => onClose() });
  }

  return (
    <div
      role="dialog"
      aria-label={`Modifica ${label}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <div className="max-h-[85vh] w-full max-w-sm overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet">
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="border-b border-slate-100 px-5 pb-3 pt-3">
          <h2 className="text-[17px] font-semibold text-slate-900">{label}</h2>
          {entry.food_brand && <p className="text-[13px] text-slate-500">{entry.food_brand}</p>}
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <span className="field-label">Pasto</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {MEALS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={meal === m}
                  onClick={() => setMeal(m)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    meal === m
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-slate-300 text-slate-700 active:bg-slate-100"
                  }`}
                >
                  {MEAL_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="edit-grams" className="field-label">
              Grammi
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="edit-grams"
                type="number"
                inputMode="numeric"
                min={0}
                value={grams}
                onChange={(e) => setGrams(Number(e.target.value))}
                className="field flex-1"
              />
              <button
                type="button"
                onClick={() => setGrams(100)}
                className="shrink-0 rounded-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 active:bg-slate-100"
              >
                100 g
              </button>
            </div>
            {gramsInvalid && (
              <p role="alert" className="mt-1.5 text-sm text-red-600">
                Inserisci una quantità valida (maggiore di 0).
              </p>
            )}
          </div>

          <dl className="grid grid-cols-4 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3 text-center">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">kcal</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-slate-900">
                {Math.round(preview.kcal)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Prot.</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-slate-900">
                {preview.protein_g.toFixed(1)} g
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Carb.</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-slate-900">
                {preview.carbs_g.toFixed(1)} g
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Grassi</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-slate-900">
                {preview.fat_g.toFixed(1)} g
              </dd>
            </div>
          </dl>

          {patchEntry.isError && (
            <p role="alert" className="text-sm text-red-600">
              Errore durante il salvataggio delle modifiche.
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Annulla
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="btn-primary flex-1">
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditEntrySheet;
