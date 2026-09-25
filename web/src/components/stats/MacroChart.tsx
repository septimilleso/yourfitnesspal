import { type ChartPoint, MACRO_SERIES } from "../../lib/stats";
import { labelStep } from "./KcalChart";

const WIDTH = 320;
const HEIGHT = 160;
const TOP = 12;
const BOTTOM = 20;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

/** Stacked protein/carbs/fat grams per day (or week). */
function MacroChart({ points }: { points: ChartPoint[] }) {
  const hasData = points.some((point) => point.logged);
  const max =
    Math.max(1, ...points.map((point) => point.protein_g + point.carbs_g + point.fat_g)) * 1.1;
  const slot = WIDTH / Math.max(points.length, 1);
  const barWidth = Math.max(slot * 0.7, 1);
  const scale = (grams: number) => (grams / max) * PLOT_HEIGHT;
  const step = labelStep(points.length);

  return (
    <section className="card space-y-2 px-4 py-3">
      <h2 className="section-label">Macro (g)</h2>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-slate-500">Nessun dato nel periodo</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-label="Macro per periodo">
            {points.map((point, index) => {
              if (!point.logged) return null;
              let base = TOP + PLOT_HEIGHT;
              return (
                <g key={point.key}>
                  {MACRO_SERIES.map((series) => {
                    const height = scale(point[series.key]);
                    base -= height;
                    return (
                      <rect
                        key={series.key}
                        data-testid="macro-segment"
                        x={index * slot + (slot - barWidth) / 2}
                        y={base}
                        width={barWidth}
                        height={height}
                        fill={series.color}
                      >
                        <title>{`${point.label} · ${series.label}: ${point[series.key]} g`}</title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
            {points.map((point, index) =>
              index % step === 0 ? (
                <text
                  key={point.key}
                  x={index * slot + slot / 2}
                  y={HEIGHT - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#64748b"
                >
                  {point.label}
                </text>
              ) : null,
            )}
          </svg>
          <ul className="flex justify-center gap-4 text-xs text-slate-600">
            {MACRO_SERIES.map((series) => (
              <li key={series.key} className="flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: series.color }} />
                {series.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default MacroChart;
