import { useState } from "react";

import type { WeightDay } from "../../api/weights";
import { useDeleteWeight, useWeightHistory } from "../../api/weights";
import { formatIsoDateLong } from "../../lib/date";
import { formatKg } from "../../lib/gym";
import type { Period } from "../../lib/stats";
import WeightChart from "./WeightChart";

/** Weight history and chart for the selected diary-statistics period. */
function WeightSection({ period, enabled }: { period: Period; enabled: boolean }) {
  const history = useWeightHistory(period.start, period.end, enabled);
  const deleteWeight = useDeleteWeight();
  const [deleteError, setDeleteError] = useState(false);
  const weighIns = (history.data?.days ?? [])
    .filter((day): day is WeightDay & { id: number; weight_kg: number } => day.id !== null && day.weight_kg !== null)
    .sort((left, right) => right.date.localeCompare(left.date));

  if (!enabled) return null;

  return (
    <section className="card space-y-2 px-4 py-3">
      <h2 className="section-label">Peso</h2>
      {deleteError && (
        <p role="alert" className="text-sm text-red-600">Impossibile eliminare la pesata.</p>
      )}
      {history.isError ? (
        <p role="alert" className="text-sm text-red-600">Impossibile caricare il peso.</p>
      ) : history.isLoading ? (
        <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>
      ) : weighIns.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Nessuna pesata nel periodo</p>
      ) : (
        <>
          <WeightChart days={history.data?.days ?? []} />
          <ul className="divide-y divide-slate-100">
            {weighIns.map((day) => {
              const date = formatIsoDateLong(day.date);
              return (
                <li key={day.date} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-slate-700">{date}</span>
                  <span className="ml-auto font-medium tabular-nums text-slate-900">{formatKg(day.weight_kg)} kg</span>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                    aria-label={`Elimina pesata del ${date}`}
                    onClick={() => {
                      if (!window.confirm("Eliminare questa pesata?")) return;
                      setDeleteError(false);
                      deleteWeight.mutate(day.id, {
                        onSuccess: () => setDeleteError(false),
                        onError: () => setDeleteError(true),
                      });
                    }}
                  >
                    Elimina
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export default WeightSection;
