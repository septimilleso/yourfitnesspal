import type { GymStats } from "../../api/gym";

/** Period totals for finished workouts. */
function GymSummaryCard({ stats }: { stats: GymStats }) {
  const rows: [string, string][] = [
    ["Allenamenti", String(stats.workouts)],
    ["Volume", `${stats.volume_kg.toLocaleString("it-IT", { useGrouping: true })} kg`],
    ["Durata media", stats.avg_duration_min === null ? "—" : `${stats.avg_duration_min} min`],
  ];

  return (
    <section className="card overflow-hidden">
      <h2 className="section-label px-4 pt-3">Riepilogo</h2>
      <dl className="divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-2.5 text-[15px]">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
      {stats.workouts === 0 && (
        <p className="px-4 pb-3 text-center text-sm text-slate-500">Nessun allenamento nel periodo</p>
      )}
    </section>
  );
}

export default GymSummaryCard;
