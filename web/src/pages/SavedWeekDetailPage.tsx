import { Link, useParams } from "react-router-dom";

import { useSavedWeek } from "../api/savedWeeks";
import type { Meal } from "../api/queries";
import { MEALS } from "../api/queries";
import ModeSwitch from "../components/ModeSwitch";
import { MEAL_LABELS } from "../lib/meals";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

function SavedWeekDetailPage() {
  const { id } = useParams();
  const week = useSavedWeek(Number(id));

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <Link
            to="/week/saved"
            className="mb-1 inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700"
          >
            &lsaquo; Salvate
          </Link>
          <h1 className="truncate text-center text-[17px] font-semibold text-slate-900">
            {week.data?.name ?? "Settimana salvata"}
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {week.isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}
        {week.isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">Settimana non trovata.</p>
        )}

        {week.data?.days.map((day) => {
          const label = WEEKDAY_LABELS[day.day_index] ?? "";
          const hasMeals = MEALS.some((meal) => day.meals[meal].length > 0);

          return (
            <section key={day.day_index} className="card overflow-hidden" aria-label={label}>
              <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                <h2 className="text-[15px] font-semibold text-slate-900">{label}</h2>
              </div>

              <div className="space-y-3 px-3 py-3">
                <div className="flex items-baseline">
                  <span className="text-2xl font-bold tabular-nums text-slate-900">
                    {Math.round(day.total.kcal)}
                  </span>
                  <span className="ml-1 text-xs text-slate-400">kcal</span>
                </div>

                <dl className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 pt-2 text-center text-[11px] text-slate-500">
                  <div>
                    <dt>Prot.</dt>
                    <dd className="text-sm font-semibold tabular-nums text-slate-700">
                      {Math.round(day.total.protein_g)}g
                    </dd>
                  </div>
                  <div>
                    <dt>Carb.</dt>
                    <dd className="text-sm font-semibold tabular-nums text-slate-700">
                      {Math.round(day.total.carbs_g)}g
                    </dd>
                  </div>
                  <div>
                    <dt>Grassi</dt>
                    <dd className="text-sm font-semibold tabular-nums text-slate-700">
                      {Math.round(day.total.fat_g)}g
                    </dd>
                  </div>
                </dl>

                {!hasMeals ? (
                  <p className="text-sm text-slate-500">Nessun pasto</p>
                ) : (
                  <div className="space-y-3 border-t border-slate-100 pt-3">
                    {MEALS.map((meal: Meal) => {
                      const items = day.meals[meal];
                      if (items.length === 0) return null;

                      return (
                        <section key={meal} aria-label={MEAL_LABELS[meal]}>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            {MEAL_LABELS[meal]}
                          </h3>
                          <ul className="mt-1 space-y-1">
                            {items.map((item) => (
                              <li key={item.id} className="text-sm text-slate-700">
                                {item.food_name} — {item.grams} g
                                {item.portion_label ? ` (${item.portion_label})` : ""}
                              </li>
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default SavedWeekDetailPage;
