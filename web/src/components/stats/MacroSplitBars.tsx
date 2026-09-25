import { MACRO_SERIES, type MacroSplit } from "../../lib/stats";

function SplitRow({ label, split }: { label: string; split: MacroSplit }) {
  return (
    <div role="group" aria-label={label} className="space-y-1">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <div className="flex h-6 overflow-hidden rounded-lg">
        {MACRO_SERIES.map((series) => (
          <div
            key={series.split}
            className="flex items-center justify-center text-[11px] font-semibold text-white"
            style={{ width: `${split[series.split]}%`, background: series.color }}
          >
            {split[series.split] >= 8 && <span data-macro={series.split}>{split[series.split]}%</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Average macro calorie split for the period next to the goal split. */
function MacroSplitBars({ consumed, target }: { consumed: MacroSplit | null; target: MacroSplit | null }) {
  return (
    <section className="card space-y-3 px-4 py-3">
      <h2 className="section-label">Ripartizione macro</h2>
      {consumed === null ? (
        <p className="py-4 text-center text-sm text-slate-500">Nessun dato nel periodo</p>
      ) : (
        <>
          <SplitRow label="Consumato" split={consumed} />
          {target !== null && <SplitRow label="Obiettivo" split={target} />}
        </>
      )}
    </section>
  );
}

export default MacroSplitBars;
