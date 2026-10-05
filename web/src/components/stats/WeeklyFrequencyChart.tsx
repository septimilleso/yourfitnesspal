import type { GymWeek } from "../../api/gym";
import { formatIsoDateShort } from "../../lib/date";
import { formatChartTick, niceTicks } from "../../lib/chartTicks";
import { labelStep } from "./KcalChart";

const WIDTH = 320;
const HEIGHT = 160;
const LEFT = 44;
const RIGHT = 6;
const TOP = 12;
const BOTTOM = 20;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;

/** Weekly workout frequency, including empty ISO weeks. */
function WeeklyFrequencyChart({ weeks }: { weeks: GymWeek[] }) {
  const max = Math.max(0, ...weeks.map((week) => week.workouts));
  const ticks = niceTicks(0, max, 4, true);
  const minTick = ticks[0];
  const maxTick = ticks[ticks.length - 1];
  const slot = PLOT_WIDTH / Math.max(weeks.length, 1);
  const barWidth = Math.max(slot * 0.7, 1);
  const y = (value: number) => TOP + PLOT_HEIGHT - ((value - minTick) / (maxTick - minTick)) * PLOT_HEIGHT;
  const step = labelStep(weeks.length);

  return (
    <section className="card space-y-2 px-4 py-3">
      <h2 className="section-label">Frequenza settimanale</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-label="Frequenza settimanale">
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
              {formatChartTick(tick, "", 0)}
            </text>
          </g>
        ))}
        {weeks.map((week, index) => {
          const baseline = y(0);
          const height = Math.max(baseline - y(week.workouts), 1);
          const label = formatIsoDateShort(week.week_start);
          return (
            <g key={week.week_start}>
              <rect
                data-testid="frequency-bar"
                x={LEFT + index * slot + (slot - barWidth) / 2}
                y={baseline - height}
                width={barWidth}
                height={height}
                rx={Math.min(3, barWidth / 2)}
                fill="#16a34a"
              >
                <title>{`${label}: ${week.workouts} ${week.workouts === 1 ? "allenamento" : "allenamenti"}`}</title>
              </rect>
              {index % step === 0 && (
                <text
                  x={LEFT + index * slot + slot / 2}
                  y={HEIGHT - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="#64748b"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

export default WeeklyFrequencyChart;
