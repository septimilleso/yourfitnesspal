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

export function mascot(mode: AppMode): string {
  return `/art/${mode}/mascot.webp`;
}

export function pattern(mode: AppMode): string {
  return `/art/${mode}/pattern.webp`;
}

export function scene(mode: AppMode): string {
  return `/art/${mode}/scene.webp`;
}

export const MEAL_ICONS: Record<Meal, string> = {
  breakfast: artIcon("diet", "egg"),
  lunch: artIcon("diet", "salad"),
  dinner: artIcon("diet", "soup"),
  snack: artIcon("diet", "apple"),
};
