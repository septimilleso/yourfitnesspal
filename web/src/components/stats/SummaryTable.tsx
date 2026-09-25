import type { PeriodSummary } from "../../lib/stats";

const DASH = "–";

/** Period averages (logged days only) and day counts. */
function SummaryTable({ summary }: { summary: PeriodSummary }) {
  const { averages } = summary;
  const rows: [string, string][] = [
    ["Calorie medie", averages ? `${averages.kcal} kcal` : DASH],
    ["Proteine medie", averages ? `${averages.protein_g} g` : DASH],
    ["Carboidrati medi", averages ? `${averages.carbs_g} g` : DASH],
    ["Grassi medi", averages ? `${averages.fat_g} g` : DASH],
    ["Giorni registrati", `${summary.loggedDays} / ${summary.totalDays}`],
    ["Giorni sopra obiettivo", summary.daysOverGoal === null ? DASH : String(summary.daysOverGoal)],
  ];
  return (
    <section className="card overflow-hidden">
      <h2 className="section-label px-4 pt-3">Medie del periodo</h2>
      <dl className="divide-y divide-slate-100">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-2.5 text-[15px]">
            <dt className="text-slate-600">{label}</dt>
            <dd className="font-medium tabular-nums text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default SummaryTable;
