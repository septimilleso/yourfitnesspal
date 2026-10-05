import type { PersonalRecord } from "../../api/gym";
import { formatIsoDateLong } from "../../lib/date";
import { formatDuration, formatKg } from "../../lib/gym";

const labels: Record<string, string> = {
  max_weight_kg: "Carico massimo",
  max_1rm_kg: "1RM stimato",
  max_reps: "Reps massime",
  max_duration_s: "Durata massima",
};

function formatValue(record: PersonalRecord): string {
  if (record.kind.endsWith("_kg")) return `${formatKg(record.value)} kg`;
  if (record.kind.endsWith("_s")) return formatDuration(record.value);
  return `${record.value} reps`;
}

/** All-time personal records for an exercise. */
function PersonalRecords({ records }: { records: PersonalRecord[] }) {
  return (
    <section className="card space-y-2 px-4 py-3">
      <h3 className="section-label">Record personali</h3>
      {records.length === 0 ? (
        <p className="text-sm text-slate-500">Nessun record personale</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {records.map((record) => (
            <li key={record.kind} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm">
              <span className="text-slate-600">{labels[record.kind] ?? record.kind}</span>
              <span className="font-medium text-slate-900">{formatValue(record)}</span>
              <time className="w-full text-xs text-slate-500">{formatIsoDateLong(record.date)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default PersonalRecords;
