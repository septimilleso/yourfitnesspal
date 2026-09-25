import { describe, expect, it } from "vitest";

import type { Goal, WeekDayTotal } from "../api/queries";
import {
  chartPoints,
  countDays,
  macroSplit,
  presetPeriod,
  summarize,
  validateCustomPeriod,
} from "./stats";

function day(date: string, kcal: number, protein_g = 0, carbs_g = 0, fat_g = 0): WeekDayTotal {
  return {
    date,
    total: { kcal, protein_g, carbs_g, sugars_g: 0, fat_g, sat_fat_g: 0, fiber_g: 0, salt_g: 0 },
  } as WeekDayTotal;
}

const goal: Goal = { id: 1, kcal: 2000, protein_g: 150, carbs_g: 250, fat_g: 70, valid_from: "2026-01-01" };

describe("periods", () => {
  it("builds presets ending today", () => {
    expect(presetPeriod(7, "2026-09-25")).toEqual({ start: "2026-09-19", end: "2026-09-25" });
    expect(presetPeriod(30, "2026-09-25")).toEqual({ start: "2026-08-27", end: "2026-09-25" });
  });

  it("counts days inclusively", () => {
    expect(countDays("2026-09-25", "2026-09-25")).toBe(1);
    expect(countDays("2025-01-01", "2026-01-01")).toBe(366);
  });

  it("validates custom periods", () => {
    const today = "2026-09-25";
    expect(validateCustomPeriod("", "2026-09-10", today)).toBe("Scegli entrambe le date.");
    expect(validateCustomPeriod("2026-09-10", "2026-09-01", today)).toBe(
      "La data iniziale deve precedere quella finale.",
    );
    expect(validateCustomPeriod("2026-09-10", "2026-09-26", today)).toBe(
      "Le date non possono essere nel futuro.",
    );
    expect(validateCustomPeriod("2025-09-24", "2026-09-25", today)).toBe(
      "L'intervallo può coprire al massimo 366 giorni.",
    );
    expect(validateCustomPeriod("2026-09-01", "2026-09-25", today)).toBeNull();
  });
});

describe("chartPoints", () => {
  it("keeps one rounded point per day up to 31 days", () => {
    const points = chartPoints([day("2026-09-01", 1800.4, 100.6, 200, 60), day("2026-09-02", 0)]);
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ key: "2026-09-01", kcal: 1800, protein_g: 101, logged: true });
    expect(points[1]).toMatchObject({ key: "2026-09-02", kcal: 0, logged: false });
  });

  it("averages logged days per ISO week beyond 31 days", () => {
    const days: WeekDayTotal[] = [];
    // 2026-08-03 is a Monday; 35 days = 5 full weeks.
    for (let i = 0; i < 35; i += 1) {
      const date = new Date(Date.UTC(2026, 7, 3 + i)).toISOString().slice(0, 10);
      days.push(day(date, i < 7 ? (i < 2 ? 2000 : 0) : 1000, 10, 20, 5));
    }
    const points = chartPoints(days);
    expect(points).toHaveLength(5);
    expect(points[0]).toMatchObject({ key: "2026-08-03", kcal: 2000, logged: true });
    expect(points[1]).toMatchObject({ key: "2026-08-10", kcal: 1000, protein_g: 10 });
  });
});

describe("summarize", () => {
  it("averages logged days only and counts days over goal", () => {
    const summary = summarize(
      [day("2026-09-01", 2500, 100, 300, 80), day("2026-09-02", 0), day("2026-09-03", 1500, 50, 100, 40)],
      goal,
    );
    expect(summary).toEqual({
      totalDays: 3,
      loggedDays: 2,
      averages: { kcal: 2000, protein_g: 75, carbs_g: 200, fat_g: 60 },
      daysOverGoal: 1,
    });
  });

  it("handles no logged days and no goal", () => {
    expect(summarize([day("2026-09-01", 0)], null)).toEqual({
      totalDays: 1,
      loggedDays: 0,
      averages: null,
      daysOverGoal: null,
    });
  });
});

describe("macroSplit", () => {
  it("returns calorie percentages summing to 100", () => {
    expect(macroSplit({ protein_g: 150, carbs_g: 250, fat_g: 70 })).toEqual({ protein: 27, carbs: 45, fat: 28 });
  });

  it("returns null without macros", () => {
    expect(macroSplit({ protein_g: 0, carbs_g: 0, fat_g: 0 })).toBeNull();
  });
});
