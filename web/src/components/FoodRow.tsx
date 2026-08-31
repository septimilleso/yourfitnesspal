import type { DiaryEntry } from "../api/queries";

interface FoodRowProps {
  entry: DiaryEntry;
  onEdit: (entry: DiaryEntry) => void;
  onDelete: (id: number) => void;
  deleting?: boolean;
}

/** A single logged food within a `MealSection`. `DiaryEntryOut` carries the
 * logged food's `food_name`/`food_brand` (joined server-side from the
 * related `Food` row), so this shows the real name -- the `Alimento #id`
 * fallback only fires for a malformed/incomplete API response.
 *
 * The name/detail area is a button: tapping it opens the edit sheet
 * (`onEdit`). The trash button is a sibling, not nested, so its tap never
 * also triggers `onEdit`.
 *
 * Row separators come from the parent `<ul>`'s `divide-y`, so a row never
 * has to know whether it's the last one. */
function FoodRow({ entry, onEdit, onDelete, deleting = false }: FoodRowProps) {
  const kcal = Math.round((entry.nutriments_snapshot.kcal * entry.grams) / 100);
  const label = entry.food_name || `Alimento #${entry.food_id}`;

  return (
    <li className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <button
        type="button"
        onClick={() => onEdit(entry)}
        disabled={deleting}
        aria-label={`Modifica ${label}`}
        className="min-w-0 flex-1 text-left disabled:opacity-40"
      >
        <span className="block truncate text-[15px] font-medium text-slate-900">{label}</span>
        <span className="block truncate text-[13px] text-slate-500">
          {entry.food_brand ? `${entry.food_brand} · ` : ""}
          {entry.grams} g
        </span>
      </button>

      <span className="shrink-0 tabular-nums text-[15px] font-semibold text-slate-700">
        {kcal}
        <span className="ml-0.5 text-[11px] font-medium text-slate-400">kcal</span>
      </span>

      {/* Icon-only destructive action: a full-width "Elimina" word per row
          made every row look like a button. Accessible name still spells
          out which food it deletes. */}
      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        disabled={deleting}
        aria-label={`Elimina ${label}`}
        className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition active:bg-red-50 active:text-red-600 disabled:opacity-40"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden
        >
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>
    </li>
  );
}

export default FoodRow;
