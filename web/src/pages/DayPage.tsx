import { useSearchParams } from "react-router-dom";

import { MEALS, useDayDiary, useDeleteEntry } from "../api/queries";
import DaySummary from "../components/DaySummary";
import MealSection from "../components/MealSection";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Day diary: date header with prev/next navigation (date lives in the
 * `?date=` search param), calorie/macro summary, and one `MealSection` per
 * meal slot. */
function DayPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get("date") ?? todayIso();

  const { data, isLoading, isError } = useDayDiary(date);
  const deleteEntry = useDeleteEntry();

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
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Giorno precedente"
          onClick={() => goToDate(shiftIsoDate(date, -1))}
          className="rounded px-3 py-1 text-xl text-slate-600 hover:bg-slate-100"
        >
          &lsaquo;
        </button>
        <h1 className="text-lg font-bold text-slate-900">{date}</h1>
        <button
          type="button"
          aria-label="Giorno successivo"
          onClick={() => goToDate(shiftIsoDate(date, 1))}
          className="rounded px-3 py-1 text-xl text-slate-600 hover:bg-slate-100"
        >
          &rsaquo;
        </button>
      </header>

      {isLoading && <p className="text-center text-slate-500">Caricamento...</p>}
      {isError && <p className="text-center text-red-600">Errore nel caricamento del diario.</p>}

      {data && (
        <>
          <DaySummary total={data.totals.total} goal={data.goal} />
          <div className="space-y-3">
            {MEALS.map((meal) => (
              <MealSection
                key={meal}
                meal={meal}
                date={date}
                entries={data.entries[meal] ?? []}
                onDelete={handleDelete}
                deletingId={deletingId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default DayPage;
