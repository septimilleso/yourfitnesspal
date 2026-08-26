import { Link } from "react-router-dom";

import type { DiaryEntry, Meal } from "../api/queries";
import FoodRow from "./FoodRow";

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Colazione",
  lunch: "Pranzo",
  dinner: "Cena",
  snack: "Spuntino",
};

interface MealSectionProps {
  meal: Meal;
  date: string;
  entries: DiaryEntry[];
  onDelete: (id: number) => void;
  deletingId: number | null;
}

function MealSection({ meal, date, entries, onDelete, deletingId }: MealSectionProps) {
  const kcalTotal = entries.reduce(
    (sum, entry) => sum + (entry.nutriments_snapshot.kcal * entry.grams) / 100,
    0,
  );

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {MEAL_LABELS[meal]}
        </h2>
        <span className="text-sm text-slate-500">{Math.round(kcalTotal)} kcal</span>
      </div>

      {entries.length > 0 ? (
        <ul className="mt-2">
          {entries.map((entry) => (
            <FoodRow
              key={entry.id}
              entry={entry}
              onDelete={onDelete}
              deleting={deletingId === entry.id}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-slate-400">Nessun alimento registrato</p>
      )}

      <Link
        to={`/search?date=${date}&meal=${meal}`}
        className="mt-3 inline-block text-sm font-medium text-slate-900 hover:underline"
      >
        + Aggiungi
      </Link>
    </section>
  );
}

export default MealSection;
