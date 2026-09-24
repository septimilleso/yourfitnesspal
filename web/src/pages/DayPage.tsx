import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { MEALS, useDayDiary, useDeleteEntry } from "../api/queries";
import DaySummary from "../components/DaySummary";
import EditEntrySheet from "../components/EditEntrySheet";
import MealSection from "../components/MealSection";
import ModeSwitch from "../components/ModeSwitch";
import { formatIsoDateLong, relativeDayLabel, shiftIsoDate, todayIso } from "../lib/date";

/** Day diary: date header with prev/next navigation (date lives in the
 * `?date=` search param), calorie/macro summary, and one `MealSection` per
 * meal slot. The header is sticky and safe-area padded (see `.app-header`
 * in index.css) so the date stays reachable while scrolling a long day and
 * never slides under the iPhone status bar. */
function DayPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get("date") ?? todayIso();

  const { data, isLoading, isError } = useDayDiary(date);
  const deleteEntry = useDeleteEntry();
  const [editingId, setEditingId] = useState<number | null>(null);
  const editing = data
    ? (Object.values(data.entries).flat().find((e) => e.id === editingId) ?? null)
    : null;

  const relative = relativeDayLabel(date);
  const isToday = date === todayIso();

  function goToDate(nextDate: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("date", nextDate);
      return next;
    });
  }

  function handleDelete(entryId: number) {
    deleteEntry.mutate(entryId);
  }

  const deletingId = deleteEntry.isPending ? (deleteEntry.variables ?? null) : null;

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <button
            type="button"
            aria-label="Giorno precedente"
            onClick={() => goToDate(shiftIsoDate(date, -1))}
            className="btn-ghost w-11 text-2xl leading-none"
          >
            &lsaquo;
          </button>

          <div className="min-w-0 text-center">
            <h1 className="truncate text-[17px] font-semibold capitalize text-slate-900">
              {formatIsoDateLong(date)}
            </h1>
            {relative && (
              <span className="text-xs font-medium text-brand-600">{relative}</span>
            )}
          </div>

          <button
            type="button"
            aria-label="Giorno successivo"
            onClick={() => goToDate(shiftIsoDate(date, 1))}
            className="btn-ghost w-11 text-2xl leading-none"
          >
            &rsaquo;
          </button>
        </div>

        {/* "Oggi" escape hatch: after paging back a few days, returning
            otherwise means tapping ‹/› the same number of times. */}
        {!isToday && (
          <div className="mx-auto flex max-w-2xl justify-center pb-2">
            <button
              type="button"
              onClick={() => goToDate(todayIso())}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 active:bg-slate-200"
            >
              Torna a oggi
            </button>
          </div>
        )}
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {isLoading && (
          <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>
        )}
        {isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">
            Errore nel caricamento del diario.
          </p>
        )}

        {data && (
          <>
            <DaySummary total={data.totals.total} goal={data.goal} />

            <div className="space-y-3">
              <h2 className="section-label">Pasti</h2>
              {MEALS.map((meal) => (
                <MealSection
                  key={meal}
                  meal={meal}
                  date={date}
                  entries={data.entries[meal] ?? []}
                  onEdit={(entry) => setEditingId(entry.id)}
                  onDelete={handleDelete}
                  deletingId={deletingId}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {editing && (
        <EditEntrySheet key={editing.id} entry={editing} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}

export default DayPage;
