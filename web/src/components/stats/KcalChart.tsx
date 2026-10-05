import type { ChartPoint } from "../../lib/stats";
import { formatChartTick, niceTicks } from "../../lib/chartTicks";

const WIDTH = 320;
const HEIGHT = 160;
const LEFT = 72;
const RIGHT = 6;
const TOP = 12;
const BOTTOM = 20;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const UNDER_GOAL = "#16a34a";
const OVER_GOAL = "#dc2626";
const NO_GOAL = "#94a3b8";

/** Every Nth label so at most ~7 fit under the bars. */
export function labelStep(count: number): number {
  return Math.max(1, Math.ceil(count / 7));
}

/** Daily (or weekly) kcal bars with a dashed goal line. */
function KcalChart({ points, goalKcal }: { points: ChartPoint[]; goalKcal: number | null }) {
  const hasData = points.some((point) => point.logged);
  const max = Math.max(goalKcal ?? 0, ...points.map((point) => point.kcal), 1);
  const ticks = niceTicks(0, max, 4, true);
  const minTick = ticks[0];
  const maxTick = ticks[ticks.length - 1];
  const slot = PLOT_WIDTH / Math.max(points.length, 1);
  const barWidth = Math.max(slot * 0.7, 1);
  const y = (value: number) => TOP + PLOT_HEIGHT - ((value - minTick) / (maxTick - minTick)) * PLOT_HEIGHT;
  const step = labelStep(points.length);

  return (
    <section className="card space-y-2 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h2 className="section-label">Calorie</h2>
        {goalKcal !== null && <span className="text-xs text-slate-500">Obiettivo {goalKcal} kcal</span>}
      </div>
      {!hasData ? (
        <p className="py-8 text-center text-sm text-slate-500">Nessun dato nel periodo</p>
      ) : (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-label="Calorie per periodo">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                data-testid="chart-gridline"
                x1={LEFT}
                x2={WIDTH - RIGHT}
                y1={y(tick)}
                y2={y(tick)}
                stroke="#f1f5f9"
                strokeWidth={1}
              />
              <text
                data-testid="y-axis-label"
                x={LEFT - 5}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize={13}
                fill="#64748b"
              >
                {formatChartTick(tick, "kcal", 0)}
              </text>
            </g>
          ))}
          {points.map((point, index) =>
            point.logged ? (
              <rect
                key={point.key}
                data-testid="kcal-bar"
                x={LEFT + index * slot + (slot - barWidth) / 2}
                y={y(point.kcal)}
                width={barWidth}
                height={y(0) - y(point.kcal)}
                rx={Math.min(3, barWidth / 2)}
                fill={goalKcal === null ? NO_GOAL : point.kcal > goalKcal ? OVER_GOAL : UNDER_GOAL}
              >
                <title>{`${point.label}: ${point.kcal} kcal`}</title>
              </rect>
            ) : null,
          )}
          {goalKcal !== null && (
            <line
              data-testid="goal-line"
              x1={LEFT}
              x2={WIDTH - RIGHT}
              y1={y(goalKcal)}
              y2={y(goalKcal)}
              stroke="#475569"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}
          {points.map((point, index) =>
            index % step === 0 ? (
              <text
                key={point.key}
                x={LEFT + index * slot + slot / 2}
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
      )}
    </section>
  );
}

export default KcalChart;
