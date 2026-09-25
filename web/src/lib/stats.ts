import type { Goal, WeekDayTotal } from "../api/queries";
import { formatIsoDateShort, shiftIsoDate, startOfWeek } from "./date";
import { normalizeMacroPercentages } from "./goalMath";

export type Preset = 7 | 30 | 90;
export const PRESETS: Preset[] = [7, 30, 90];
export const MAX_RANGE_DAYS = 366;
/** Beyond this many days the charts show one bar per week. */
const DAILY_POINTS_LIMIT = 31;

export interface Period {
  start: string;
  end: string;
}

export const MACRO_SERIES: {
  key: "protein_g" | "carbs_g" | "fat_g";
  split: keyof MacroSplit;
  label: string;
  color: string;
}[] = [
  { key: "protein_g", split: "protein", label: "Proteine", color: "#3b82f6" },
  { key: "carbs_g", split: "carbs", label: "Carboidrati", color: "#f59e0b" },
  { key: "fat_g", split: "fat", label: "Grassi", color: "#a855f7" },
];

export function presetPeriod(days: Preset, today: string): Period {
  return { start: shiftIsoDate(today, -(days - 1)), end: today };
}

function isoToUtcMs(iso: string): number {
  const [year, month, dayOfMonth] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, dayOfMonth);
}

export function countDays(start: string, end: string): number {
  return Math.round((isoToUtcMs(end) - isoToUtcMs(start)) / 86_400_000) + 1;
}

/** Error message for an invalid custom range, or `null` when it is valid. */
export function validateCustomPeriod(from: string, to: string, today: string): string | null {
  if (!from || !to) return "Scegli entrambe le date.";
  if (from > to) return "La data iniziale deve precedere quella finale.";
  if (to > today) return "Le date non possono essere nel futuro.";
  if (countDays(from, to) > MAX_RANGE_DAYS) return "L'intervallo può coprire al massimo 366 giorni.";
  return null;
}

export interface ChartPoint {
  key: string;
  label: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  logged: boolean;
}

export interface Averages {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

function isLogged(day: WeekDayTotal): boolean {
  return day.total.kcal > 0;
}

function average(days: WeekDayTotal[]): Averages | null {
  const logged = days.filter(isLogged);
  if (logged.length === 0) return null;
  const mean = (pick: (day: WeekDayTotal) => number) =>
    Math.round(logged.reduce((sum, day) => sum + pick(day), 0) / logged.length);
  return {
    kcal: mean((day) => day.total.kcal),
    protein_g: mean((day) => day.total.protein_g),
    carbs_g: mean((day) => day.total.carbs_g),
    fat_g: mean((day) => day.total.fat_g),
  };
}

function toPoint(key: string, days: WeekDayTotal[]): ChartPoint {
  const averages = average(days);
  return {
    key,
    label: formatIsoDateShort(key),
    kcal: averages?.kcal ?? 0,
    protein_g: averages?.protein_g ?? 0,
    carbs_g: averages?.carbs_g ?? 0,
    fat_g: averages?.fat_g ?? 0,
    logged: averages !== null,
  };
}

/** One point per day up to 31 days; beyond that one point per ISO week
 * (keyed by its Monday) with the average of that week's logged days. */
export function chartPoints(days: WeekDayTotal[]): ChartPoint[] {
  if (days.length <= DAILY_POINTS_LIMIT) {
    return days.map((day) => toPoint(day.date, [day]));
  }
  const weeks = new Map<string, WeekDayTotal[]>();
  for (const day of days) {
    const monday = startOfWeek(day.date);
    weeks.set(monday, [...(weeks.get(monday) ?? []), day]);
  }
  return [...weeks.entries()].map(([monday, weekDays]) => toPoint(monday, weekDays));
}

export interface PeriodSummary {
  totalDays: number;
  loggedDays: number;
  averages: Averages | null;
  daysOverGoal: number | null;
}

export function summarize(days: WeekDayTotal[], goal: Goal | null): PeriodSummary {
  const logged = days.filter(isLogged);
  return {
    totalDays: days.length,
    loggedDays: logged.length,
    averages: average(days),
    daysOverGoal: goal ? logged.filter((day) => day.total.kcal > goal.kcal).length : null,
  };
}

export interface MacroSplit {
  protein: number;
  carbs: number;
  fat: number;
}

/** Calorie share of each macro (4/4/9 kcal per gram) as integer percentages
 * summing to 100, or `null` when all macros are zero. */
export function macroSplit(grams: { protein_g: number; carbs_g: number; fat_g: number }): MacroSplit | null {
  const split = normalizeMacroPercentages(grams);
  if (split.protein === null || split.carbs === null || split.fat === null) return null;
  return { protein: split.protein, carbs: split.carbs, fat: split.fat };
}
