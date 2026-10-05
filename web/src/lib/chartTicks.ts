const NICE_MULTIPLIERS = [1, 2, 2.5, 5, 10];
const EPSILON = 1e-10;

/** Return 3–5 readable tick values whose endpoints cover the requested range. */
export function niceTicks(min: number, max: number, count = 4, integer = false, maxFractionDigits?: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1, 2, 3, 4];
  if (max < min) [min, max] = [max, min];
  if (min === max) {
    if (min === 0) max = integer ? 2 : 1;
    else {
      const margin = Math.max(Math.abs(min) * 0.02, 0.5);
      min -= margin;
      max += margin;
    }
  }

  const targetStep = (max - min) / Math.max(count, 1);
  const precisionStep = maxFractionDigits === undefined ? 0 : 10 ** -maxFractionDigits;
  const minimumStep = integer ? Math.max(targetStep, 1) : Math.max(targetStep, precisionStep);
  const exponent = Math.floor(Math.log10(minimumStep));
  const candidates = [-3, -2, -1, 0, 1, 2, 3, 4, 5].flatMap((offset) =>
    NICE_MULTIPLIERS.map((multiplier) => multiplier * 10 ** (exponent + offset)),
  );
  const steps = candidates
    .filter((candidate) => {
      if (integer && Math.abs(Math.round(candidate) - candidate) >= EPSILON) return false;
      if (maxFractionDigits === undefined) return true;
      const precisionUnits = candidate / precisionStep;
      return Math.abs(Math.round(precisionUnits) - precisionUnits) < EPSILON;
    })
    .sort((a, b) => a - b);
  const firstCandidate = steps.findIndex((candidate) => candidate >= minimumStep);
  const allowTwoIntegerTicks = integer && min === 0 && max === 1;
  const precision = maxFractionDigits ?? Math.min(12, Math.max(0, -exponent + 2));
  const round = (value: number) => {
    const rounded = Number(value.toFixed(Math.min(12, precision)));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  for (const step of steps.slice(firstCandidate < 0 ? undefined : firstCandidate)) {
    let firstIndex = Math.floor(min / step + EPSILON);
    let lastIndex = Math.ceil(max / step - EPSILON);
    let tickCount = lastIndex - firstIndex + 1;
    if (tickCount > 5) continue;
    if (tickCount < 3 && !allowTwoIntegerTicks) {
      lastIndex += 3 - tickCount;
      tickCount = lastIndex - firstIndex + 1;
    }
    if (tickCount < 3 || tickCount > 5) continue;
    return Array.from({ length: tickCount }, (_, index) => round((firstIndex + index) * step));
  }

  return [round(min), round(max)];
}

export function formatChartTick(value: number, unit: string, maximumFractionDigits = 1): string {
  const formatted = value.toLocaleString("it-IT", { maximumFractionDigits });
  const [integer, fraction] = formatted.split(",");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const number = fraction === undefined ? grouped : `${grouped},${fraction}`;
  return unit ? `${number} ${unit}` : number;
}
