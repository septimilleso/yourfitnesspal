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
 */
function QuantityPicker({ food, date, meal, onClose, onAdded }: QuantityPickerProps) {
  const [grams, setGrams] = useState<number>(food.serving_size_g ?? 100);
  const createEntry = useCreateEntry();

  const preview = scalePreview(food.nutriments, grams || 0);
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
      className="fixed inset-0 z-10 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <div className="w-full max-w-sm space-y-4 rounded-t-lg bg-white p-4 shadow-lg sm:rounded-lg">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{food.name}</h2>
          {food.brand && <p className="text-sm text-slate-500">{food.brand}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setGrams(100)}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            100 g
          </button>
          {food.serving_size_g != null && (
            <button
              type="button"
              onClick={() => setGrams(food.serving_size_g as number)}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            >
              Porzione ({food.serving_size_g} g)
            </button>
          )}
        </div>

        <div>
          <label htmlFor="quantity-grams" className="block text-sm font-medium text-slate-700">
            Grammi
          </label>
          <input
            id="quantity-grams"
            type="number"
            min={0}
            value={grams}
            onChange={(e) => setGrams(Number(e.target.value))}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>

        <dl className="grid grid-cols-4 gap-2 text-center text-sm">
          <div>
            <dt className="text-slate-500">kcal</dt>
            <dd className="font-semibold text-slate-900">{Math.round(preview.kcal)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Prot.</dt>
            <dd className="font-semibold text-slate-900">{preview.protein_g.toFixed(1)} g</dd>
          </div>
          <div>
            <dt className="text-slate-500">Carb.</dt>
            <dd className="font-semibold text-slate-900">{preview.carbs_g.toFixed(1)} g</dd>
          </div>
          <div>
            <dt className="text-slate-500">Grassi</dt>
            <dd className="font-semibold text-slate-900">{preview.fat_g.toFixed(1)} g</dd>
          </div>
        </dl>

        {createEntry.isError && (
          <p role="alert" className="text-sm text-red-600">
            Errore durante l&apos;aggiunta dell&apos;alimento.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Aggiungi
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuantityPicker;
