import { formatIsoDateShort } from "../../lib/date";
import { formatChartTick, niceTicks } from "../../lib/chartTicks";
import { labelStep } from "./KcalChart";

const WIDTH = 320;
const HEIGHT = 160;
const LEFT = 62;
const RIGHT = 12;
const TOP = 16;
const BOTTOM = 24;

export interface ProgressPoint {
  date: string;
  value: number;
}

/** Session-by-session exercise metric. */
function ProgressChart({
  points,
  metric = "max_weight_kg",
}: {
  points: ProgressPoint[];
  metric?: string;
}) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const values = points.map((point) => point.value);
  const dataMax = Math.max(...values);
  const duration = metric.includes("duration");
  const durationInMinutes = duration && dataMax >= 60;
  const isReps = metric.includes("reps");
  const unit = duration ? (durationInMinutes ? "min" : "s") : metric.endsWith("_kg") ? "kg" : "";
  const compactKg = unit === "kg" && Math.min(...values) >= 10_000;
  const preciseCompact = compactKg && dataMax - Math.min(...values) < 1_000;
  const divisor = durationInMinutes ? 60 : compactKg ? 1000 : 1;
  const scaleValues = values.map((value) => value / divisor);
  const ticks = niceTicks(
    Math.min(...scaleValues),
    Math.max(...scaleValues),
    preciseCompact ? 2 : 4,
    isReps || (duration && !durationInMinutes),
    compactKg ? (preciseCompact ? 2 : 1) : durationInMinutes ? 2 : unit === "kg" ? 1 : undefined,
  );
  const minTick = ticks[0];
  const maxTick = ticks[ticks.length - 1];
  const x = (index: number) => LEFT + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) => TOP + plotHeight - ((value - minTick) / (maxTick - minTick)) * plotHeight;
  const step = labelStep(points.length);
  const line = points.map((point, index) => `${x(index)},${y(point.value / divisor)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-label="Progressione per sessione">
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
            {compactKg
              ? `${formatChartTick(tick, "", preciseCompact ? 2 : 1)}k kg`
              : formatChartTick(tick, unit, durationInMinutes ? 2 : isReps ? 0 : 1)}
          </text>
        </g>
      ))}
      {points.length > 1 && <polyline points={line} fill="none" stroke="#16a34a" strokeWidth={2} />}
      {points.map((point, index) => (
        <g key={`${point.date}-${index}`}>
          <circle data-testid="progress-point" cx={x(index)} cy={y(point.value / divisor)} r={4} fill="#16a34a">
            <title>{`${formatIsoDateShort(point.date)}: ${point.value}`}</title>
          </circle>
          {index % step === 0 && (
            <text x={x(index)} y={HEIGHT - 4} textAnchor="middle" fontSize={9} fill="#64748b">
              {formatIsoDateShort(point.date)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

export default ProgressChart;
