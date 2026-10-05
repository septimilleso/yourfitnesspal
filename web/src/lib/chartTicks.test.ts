import { describe, expect, it } from "vitest";

import { formatChartTick, niceTicks } from "./chartTicks";

describe("niceTicks", () => {
  it("chooses readable ticks that cover representative domains", () => {
    expect(niceTicks(0, 2500)).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(0, 4, 4, true)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(20, 30, 4, true)).toEqual([20, 25, 30]);
    expect(niceTicks(0, 1, 4, true)).toEqual([0, 1]);
    expect(niceTicks(0, 0, 4, true)).toEqual([0, 1, 2]);
    expect(niceTicks(77.2, 79.8)).toEqual([77, 78, 79, 80]);
    expect(niceTicks(77.2, 77.3, 4, false, 1)).toEqual([77.2, 77.3, 77.4]);
    expect(niceTicks(0, 0)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("uses steps representable at the requested label precision", () => {
    expect(niceTicks(77.4, 78.4, 4, false, 1)).toEqual([77, 77.5, 78, 78.5]);
  });

  it("uses the next nice step when the first one creates too many labels", () => {
    expect(niceTicks(77.3, 79.3, 4, false, 1)).toEqual([77, 78, 79, 80]);
    expect(niceTicks(3.7, 10.7)).toEqual([2.5, 5, 7.5, 10, 12.5]);
  });

  it("keeps kg tick counts and one-decimal labels consistent over varied ranges", () => {
    for (let min = 50; min <= 120; min += 1) {
      for (let tenths = 3; tenths <= 150; tenths += 1) {
        const ticks = niceTicks(min, min + tenths / 10, 4, false, 1);
        expect(ticks.length, `tick count for ${min}–${min + tenths / 10}`).toBeGreaterThanOrEqual(3);
        expect(ticks.length, `tick count for ${min}–${min + tenths / 10}`).toBeLessThanOrEqual(5);
        for (const tick of ticks) {
          const labelValue = Number(formatChartTick(tick, "", 1).replace(/\./g, "").replace(",", "."));
          expect(labelValue, `label position for ${min}–${min + tenths / 10}: ${tick}`).toBe(tick);
        }
      }
    }
  }, 20000);
});
