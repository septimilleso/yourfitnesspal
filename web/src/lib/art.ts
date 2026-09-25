import type { Meal } from "../api/queries";
import type { AppMode } from "./appMode";

export type DietIcon =
  | "cat"
  | "plate"
  | "cookbook"
  | "basket"
  | "egg"
  | "salad"
  | "soup"
  | "apple"
  | "water"
  | "chart"
  | "heart"
  | "gear";

export type GymIcon =
  | "cat"
  | "clipboard"
  | "book"
  | "calendar"
  | "dumbbell"
  | "shoe"
  | "mat"
  | "moon"
  | "bottle"
  | "chart"
  | "medal"
  | "gear";

export function artIcon(mode: AppMode, name: DietIcon | GymIcon): string {
  return `/art/${mode}/icons/${name}.png`;
}

/** Streak badge `n` (1..30) of the section's set. */
export function badgeIcon(mode: AppMode, n: number): string {
  return `/art/${mode}/badges/${String(n).padStart(2, "0")}.webp`;
}

export function mascot(mode: AppMode): string {
  return `/art/${mode}/mascot.webp`;
}

export function pattern(mode: AppMode): string {
  return `/art/${mode}/pattern.webp`;
}

export function scene(mode: AppMode): string {
  return `/art/${mode}/scene.webp`;
}

/** Cat illustration behind the settings page, per section. */
export function settingsScene(mode: AppMode): string {
  return `/art/${mode}/settings.webp`;
}

export const MEAL_ICONS: Record<Meal, string> = {
  breakfast: artIcon("diet", "egg"),
  lunch: artIcon("diet", "salad"),
  dinner: artIcon("diet", "soup"),
  snack: artIcon("diet", "apple"),
};
