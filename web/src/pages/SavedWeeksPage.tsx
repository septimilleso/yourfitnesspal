import { Link } from "react-router-dom";

import { useSavedWeeks } from "../api/savedWeeks";
import ModeSwitch from "../components/ModeSwitch";
import { formatIsoDateShort } from "../lib/date";

function SavedWeeksPage() {
  const weeks = useSavedWeeks();

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <Link
            to="/week"
            className="mb-1 inline-flex min-h-[44px] items-center text-sm font-medium text-brand-700"
          >
            &lsaquo; Settimana
          </Link>
          <h1 className="text-center text-[17px] font-semibold text-slate-900">Settimane salvate</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {weeks.isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}
        {weeks.isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">
            Errore nel caricamento delle settimane salvate.
          </p>
        )}

        {weeks.data && weeks.data.length === 0 && (
          <div className="card space-y-3 px-4 py-6 text-center">
            <p className="text-sm text-slate-500">Nessuna settimana salvata.</p>
            <Link to="/week" className="btn-secondary inline-flex min-h-[44px] items-center justify-center px-4">
              Vai a Settimana
            </Link>
          </div>
        )}

        {weeks.data?.map((week) => (
          <Link
            key={week.id}
            to={`/week/saved/${week.id}`}
            className="card block p-4 transition active:bg-slate-50"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="truncate text-[16px] font-semibold text-slate-900">{week.name}</h2>
              <span className="shrink-0 text-xs text-slate-500">
                {formatIsoDateShort(week.created_at.slice(0, 10))}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {week.entries_count} pasti <span className="mx-1 text-slate-300">·</span>
              ~{Math.round(week.avg_kcal)} kcal/giorno
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default SavedWeeksPage;
