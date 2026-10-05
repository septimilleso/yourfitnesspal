import type { WeightDay } from "../../api/weights";
import { formatIsoDateShort } from "../../lib/date";
import { formatChartTick, niceTicks } from "../../lib/chartTicks";
import { labelStep } from "./KcalChart";

const WIDTH = 320;
const HEIGHT = 160;
const LEFT = 58;
const RIGHT = 12;
const TOP = 16;
const BOTTOM = 24;

/** Daily weigh-ins and their server-computed 7-day moving average. */
function WeightChart({ days }: { days: WeightDay[] }) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const values = days.flatMap((day) => [day.weight_kg, day.avg_7d_kg].filter((value): value is number => value !== null));
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4, false, 1);
  const minTick = ticks[0];
  const maxTick = ticks[ticks.length - 1];
  const x = (index: number) => LEFT + (days.length <= 1 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth);
  const y = (value: number) => TOP + plotHeight - ((value - minTick) / (maxTick - minTick)) * plotHeight;
  const step = labelStep(days.length);
  const averagePoints = days
    .flatMap((day, index) => (day.avg_7d_kg === null ? [] : [`${x(index)},${y(day.avg_7d_kg)}`]))
    .join(" ");

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-label="Peso nel periodo">
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
            {formatChartTick(tick, "kg", 1)}
          </text>
        </g>
      ))}
      {averagePoints && (
        <polyline
          data-testid="weight-avg-line"
          points={averagePoints}
          fill="none"
          stroke="#64748b"
          strokeWidth={2}
          strokeDasharray="4 3"
        />
      )}
      {days.map((day, index) => (
        <g key={day.date}>
          {day.weight_kg !== null && (
            <circle data-testid="weight-point" cx={x(index)} cy={y(day.weight_kg)} r={4} fill="#16a34a">
              <title>{`${formatIsoDateShort(day.date)}: ${day.weight_kg} kg`}</title>
            </circle>
          )}
          {index % step === 0 && (
            <text x={x(index)} y={HEIGHT - 4} textAnchor="middle" fontSize={9} fill="#64748b">
              {formatIsoDateShort(day.date)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export default WeightChart;
