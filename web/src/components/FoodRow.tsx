import type { DiaryEntry } from "../api/queries";

interface FoodRowProps {
  entry: DiaryEntry;
  onDelete: (id: number) => void;
  deleting?: boolean;
}

/** A single logged food within a `MealSection`. `DiaryEntryOut` carries the
 * logged food's `food_name`/`food_brand` (joined server-side from the
 * related `Food` row), so this shows the real name -- the `Alimento #id`
 * fallback only fires for a malformed/incomplete API response. */
function FoodRow({ entry, onDelete, deleting = false }: FoodRowProps) {
  const kcal = Math.round((entry.nutriments_snapshot.kcal * entry.grams) / 100);
  const label = entry.food_name || `Alimento #${entry.food_id}`;

  return (
    <li className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">
          {label}
          {entry.food_brand ? <span className="text-slate-500"> &middot; {entry.food_brand}</span> : null}
        </p>
        <p className="text-xs text-slate-500">
          {entry.grams} g &middot; {kcal} kcal
        </p>
      </div>
      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        disabled={deleting}
        aria-label={`Elimina ${label}`}
        className="shrink-0 rounded px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Elimina
      </button>
    </li>
  );
}

export default FoodRow;
