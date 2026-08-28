import { useState } from "react";

import type { FoodBase, Meal, Nutriments } from "../api/queries";
import { useCreateEntry } from "../api/queries";

interface QuantityPickerProps {
  food: FoodBase;
  date: string;
  meal: Meal;
  onClose: () => void;
  onAdded: () => void;
}

/** Live macro preview for `grams` of `nutriments` (per-100g values) --
 * same `grams / 100` scaling `FoodRow`/`MealSection` use for logged
 * entries, applied client-side before the entry is even created. */
export function scalePreview(nutriments: Nutriments, grams: number) {
  const factor = grams / 100;
  return {
    kcal: nutriments.kcal * factor,
    protein_g: nutriments.protein_g * factor,
    carbs_g: nutriments.carbs_g * factor,
    fat_g: nutriments.fat_g * factor,
  };
}

/** Quantity sheet: pick a preset (100 g, or the food's own serving size)
 * or type raw grams, see a live macro preview, then confirm to log it.
 *
 * There's no API exposing a food's named `food_portions` (`FoodOut`/
 * `FoodSearchItem` don't carry them, and no endpoint lists them) -- so
 * "choose a portion" here means the food's own `serving_size_g` when
 * present, alongside a 100 g default and a free-form grams input.
 *
 * Presented as an iOS bottom sheet: it slides up from the bottom edge on a
 * phone (centred dialog from `sm:` up), carries a grabber, and pads its
 * footer past the home indicator so the confirm button is never sitting on
 * the gesture bar.
 */
function QuantityPicker({ food, date, meal, onClose, onAdded }: QuantityPickerProps) {
  const [grams, setGrams] = useState<number>(food.serving_size_g ?? 100);
  const createEntry = useCreateEntry();

  const preview = scalePreview(food.nutriments, grams || 0);
  const gramsInvalid = !(grams > 0);
  const canConfirm = grams > 0 && !createEntry.isPending;

  function handleConfirm() {
    if (!canConfirm) return;
    createEntry.mutate(
      { date, meal, food_id: food.id, grams },
      { onSuccess: () => onAdded() },
    );
  }

  return (
    <div
      role="dialog"
      aria-label={`Quantità per ${food.name}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet">
        {/* Grabber: the standard iOS affordance marking a sheet. */}
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="border-b border-slate-100 px-5 pb-3 pt-3">
          <h2 className="text-[17px] font-semibold text-slate-900">{food.name}</h2>
          {food.brand && <p className="text-[13px] text-slate-500">{food.brand}</p>}
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <span className="field-label">Porzione</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setGrams(100)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  grams === 100
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-slate-300 text-slate-700 active:bg-slate-100"
                }`}
              >
                100 g
              </button>
              {food.serving_size_g != null && (
                <button
                  type="button"
                  onClick={() => setGrams(food.serving_size_g as number)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    grams === food.serving_size_g
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-slate-300 text-slate-700 active:bg-slate-100"
                  }`}
                >
                  Porzione ({food.serving_size_g} g)
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="quantity-grams" className="field-label">
              Grammi
            </label>
            <input
              id="quantity-grams"
              type="number"
              inputMode="numeric"
              min={0}
              value={grams}
              onChange={(e) => setGrams(Number(e.target.value))}
              className="field mt-1.5"
            />
            {gramsInvalid && (
              <p role="alert" className="mt-1.5 text-sm text-red-600">
                Inserisci una quantità valida (maggiore di 0).
              </p>
            )}
          </div>

          {/* Preview panel, visually separated from the inputs above so it
              reads as a result rather than as four more fields. */}
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

          {createEntry.isError && (
            <p role="alert" className="text-sm text-red-600">
              Errore durante l&apos;aggiunta dell&apos;alimento.
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Annulla
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="btn-primary flex-1"
          >
            Aggiungi
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuantityPicker;
