import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  useDeleteSavedWeek,
  useRenameSavedWeek,
  useSavedWeek,
} from "../api/savedWeeks";
import type { Meal } from "../api/queries";
import { MEALS } from "../api/queries";
import ApplySavedWeekDialog from "../components/ApplySavedWeekDialog";
import ActionMenu from "../components/gym/ActionMenu";
import ModeSwitch from "../components/ModeSwitch";
import OfflineUnavailable from "../components/OfflineUnavailable";
import { MEAL_LABELS } from "../lib/meals";
import { useOfflineUnavailable } from "../lib/useOfflineUnavailable";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

function SavedWeekDetailPage() {
  const { id } = useParams();
  const savedWeekId = Number(id);
  const navigate = useNavigate();
  const week = useSavedWeek(savedWeekId);
  const unavailable = useOfflineUnavailable(week);
  const rename = useRenameSavedWeek();
  const remove = useDeleteSavedWeek();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dialogDays, setDialogDays] = useState<number[] | null | undefined>(undefined);

  function toggleDay(dayIndex: number) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(dayIndex)) {
        next.delete(dayIndex);
      } else {
        next.add(dayIndex);
      }
      return next;
    });
  }

  function handleCloseDialog() {
    setDialogDays(undefined);
    setSelected(new Set());
  }

  function renameSavedWeek() {
    if (!week.data) return;
    const name = window.prompt("Nome della settimana", week.data.name)?.trim();
    if (name && name !== week.data.name) rename.mutate({ id: savedWeekId, name });
  }

  function deleteSavedWeek() {
    if (!week.data || !window.confirm("Eliminare questa settimana salvata?")) return;
    remove.mutate(savedWeekId, { onSuccess: () => navigate("/week/saved", { replace: true }) });
  }

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <Link
            to="/week/saved"
            className="inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700"
          >
            &lsaquo; Salvate
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-slate-900">
            {week.data?.name ?? "Settimana salvata"}
          </h1>
          {week.data && (
            <ActionMenu
              label="Azioni settimana"
              actions={[
                { label: "Rinomina", onSelect: renameSavedWeek },
                { label: "Elimina", onSelect: deleteSavedWeek, destructive: true },
              ]}
            />
          )}
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {unavailable && <OfflineUnavailable />}
        {!unavailable && week.isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}
        {!unavailable && week.isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">Settimana non trovata.</p>
        )}

        {week.data && (
          <button
            type="button"
            onClick={() => setDialogDays(null)}
            className="btn-primary w-full"
          >
            Applica settimana&hellip;
          </button>
        )}

        {week.data?.days.map((day) => {
          const label = WEEKDAY_LABELS[day.day_index] ?? "";
          const hasMeals = MEALS.some((meal) => day.meals[meal].length > 0);

          return (
            <section key={day.day_index} className="card overflow-hidden" aria-label={label}>
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
                <label className="flex min-h-[44px] flex-1 items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(day.day_index)}
                    onChange={() => toggleDay(day.day_index)}
                    aria-label={`Seleziona ${label}`}
                  />
                  <h2 className="text-[15px] font-semibold text-slate-900">{label}</h2>
                </label>
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

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[var(--nav-height)] z-40 flex justify-center border-t border-slate-200/80 bg-white/90 p-3 shadow-sheet backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setDialogDays(Array.from(selected).sort((a, b) => a - b))}
            className="btn-primary w-full max-w-sm"
          >
            Applica {selected.size} {selected.size === 1 ? "giorno" : "giorni"}&hellip;
          </button>
        </div>
      )}

      {dialogDays !== undefined && (
        <ApplySavedWeekDialog
          savedWeekId={savedWeekId}
          days={dialogDays}
          onClose={handleCloseDialog}
        />
      )}
    </div>
  );
}

export default SavedWeekDetailPage;
