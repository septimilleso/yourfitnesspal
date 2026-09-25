import { Link } from "react-router-dom";

import type { DiaryEntry, Meal } from "../api/queries";
import { MEAL_LABELS } from "../lib/meals";
import { MEAL_ICONS } from "../lib/art";
import FoodRow from "./FoodRow";

interface MealSectionProps {
  meal: Meal;
  date: string;
  entries: DiaryEntry[];
  onEdit: (entry: DiaryEntry) => void;
  onDelete: (id: number) => void;
  deletingId: number | null;
}

function MealSection({ meal, date, entries, onEdit, onDelete, deletingId }: MealSectionProps) {
  const kcalTotal = entries.reduce(
    (sum, entry) => sum + (entry.nutriments_snapshot.kcal * entry.grams) / 100,
    0,
  );

  return (
    <section className="card overflow-hidden">
      {/* Header band: tinted + hairline-separated from the rows below, so a
          meal's boundary is visible even when it holds a single food. */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
          <img
            src={MEAL_ICONS[meal]}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="h-6 w-6"
          />
          {MEAL_LABELS[meal]}
        </h2>
        <span className="tabular-nums text-sm font-medium text-slate-500">
          {Math.round(kcalTotal)} kcal
        </span>
      </div>

      {entries.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {entries.map((entry) => (
            <FoodRow
              key={entry.id}
              entry={entry}
              onEdit={onEdit}
              onDelete={onDelete}
              deleting={deletingId === entry.id}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-slate-400">Nessun alimento registrato</p>
      )}

      <Link
        to={`/search?date=${date}&meal=${meal}`}
        className="flex min-h-[44px] items-center gap-2 border-t border-slate-100 px-4 text-[15px] font-semibold text-brand-600 active:bg-brand-50"
      >
        <span
          aria-hidden
          className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-sm leading-none text-brand-700"
        >
          +
        </span>
        Aggiungi
      </Link>
    </section>
  );
}

export default MealSection;
