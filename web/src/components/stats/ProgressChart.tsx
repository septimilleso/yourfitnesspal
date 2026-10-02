import { formatIsoDateShort } from "../../lib/date";
import { labelStep } from "./KcalChart";

const WIDTH = 320;
const HEIGHT = 160;
const LEFT = 20;
const RIGHT = 20;
const TOP = 16;
const BOTTOM = 24;

export interface ProgressPoint {
  date: string;
  value: number;
}

/** Session-by-session exercise metric. */
function ProgressChart({ points }: { points: ProgressPoint[] }) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const x = (index: number) => LEFT + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const y = (value: number) =>
    range === 0 ? TOP + plotHeight / 2 : TOP + plotHeight - ((value - min) / range) * plotHeight;
  const step = labelStep(points.length);
  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-44 w-full" role="img" aria-label="Progressione per sessione">
      {points.length > 1 && <polyline points={line} fill="none" stroke="#16a34a" strokeWidth={2} />}
      {points.map((point, index) => (
        <g key={`${point.date}-${index}`}>
          <circle data-testid="progress-point" cx={x(index)} cy={y(point.value)} r={4} fill="#16a34a">
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
