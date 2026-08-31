import type { Meal } from "../api/queries";

/** Label italiane dei 4 slot pasto. Unica fonte: sia `MealSection` sia
 * `EditEntrySheet`, sia `SearchPage` e `CopyDaysDialog` la importano, così
 * gli elenchi non divergono. */
export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Colazione",
  lunch: "Pranzo",
  dinner: "Cena",
  snack: "Spuntino",
};
