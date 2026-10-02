import type { GymWeek } from "../../api/gym";
import { formatIsoDateShort } from "../../lib/date";
import { labelStep } from "./KcalChart";

const WIDTH = 320;
const HEIGHT = 160;
const TOP = 12;
const BOTTOM = 20;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

/** Weekly workout frequency, including empty ISO weeks. */
function WeeklyFrequencyChart({ weeks }: { weeks: GymWeek[] }) {
  const max = Math.max(1, ...weeks.map((week) => week.workouts));
  const slot = WIDTH / Math.max(weeks.length, 1);
  const barWidth = Math.max(slot * 0.7, 1);
  const step = labelStep(weeks.length);

  return (
    <section className="card space-y-2 px-4 py-3">
      <h2 className="section-label">Frequenza settimanale</h2>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-label="Frequenza settimanale">
        {weeks.map((week, index) => {
          const height = Math.max((week.workouts / max) * PLOT_HEIGHT, 1);
          const y = TOP + PLOT_HEIGHT - height;
          const label = formatIsoDateShort(week.week_start);
          return (
            <g key={week.week_start}>
              <rect
                data-testid="frequency-bar"
                x={index * slot + (slot - barWidth) / 2}
                y={y}
                width={barWidth}
                height={height}
                rx={Math.min(3, barWidth / 2)}
                fill="#16a34a"
              >
                <title>{`${label}: ${week.workouts} ${week.workouts === 1 ? "allenamento" : "allenamenti"}`}</title>
              </rect>
              {index % step === 0 && (
                <text
                  x={index * slot + slot / 2}
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
