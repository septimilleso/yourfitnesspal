import type { WeightDay } from "../../api/weights";
import { formatIsoDateShort } from "../../lib/date";
import { labelStep } from "./KcalChart";

const WIDTH = 320;
const HEIGHT = 160;
const LEFT = 16;
const RIGHT = 16;
const TOP = 16;
const BOTTOM = 24;

/** Daily weigh-ins and their server-computed 7-day moving average. */
function WeightChart({ days }: { days: WeightDay[] }) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const values = days.flatMap((day) => [day.weight_kg, day.avg_7d_kg].filter((value): value is number => value !== null));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min;
  const margin = Math.max(spread * 0.1, 0.5);
  const scaleMin = min - margin;
  const scaleMax = max + margin;
  const x = (index: number) => LEFT + (days.length <= 1 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth);
  const y = (value: number) => TOP + plotHeight - ((value - scaleMin) / (scaleMax - scaleMin)) * plotHeight;
  const step = labelStep(days.length);
  const averagePoints = days
    .flatMap((day, index) => (day.avg_7d_kg === null ? [] : [`${x(index)},${y(day.avg_7d_kg)}`]))
    .join(" ");

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-label="Peso nel periodo">
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
