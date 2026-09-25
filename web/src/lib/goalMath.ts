export interface MacroPercentages {
  protein: number;
  carbs: number;
  fat: number;
}

export interface MacroGrams {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

type ExistingMacroGrams = Pick<MacroGrams, "protein_g" | "carbs_g" | "fat_g">;

/** Normalize saved macro calorie shares to integer percentages summing to 100. */
export function normalizeMacroPercentages(
  grams: ExistingMacroGrams,
): { protein: number | null; carbs: number | null; fat: number | null } {
  const shares = [
    { key: "carbs" as const, kcal: grams.carbs_g * 4 },
    { key: "protein" as const, kcal: grams.protein_g * 4 },
    { key: "fat" as const, kcal: grams.fat_g * 9 },
  ];
  const totalKcal = shares.reduce((total, share) => total + share.kcal, 0);

  if (totalKcal === 0) {
    return { protein: null, carbs: null, fat: null };
  }

  const rounded = shares.map((share, order) => {
    const exact = (share.kcal / totalKcal) * 100;
    const percentage = Math.floor(exact);
    return { ...share, order, percentage, remainder: exact - percentage };
  });
  const remaining = 100 - rounded.reduce((total, share) => total + share.percentage, 0);
  const byRemainder = [...rounded].sort(
    (a, b) => b.remainder - a.remainder || a.order - b.order,
  );

  for (let index = 0; index < remaining; index += 1) {
    byRemainder[index].percentage += 1;
  }

  const result = Object.fromEntries(rounded.map(({ key, percentage }) => [key, percentage])) as Record<
    "protein" | "carbs" | "fat",
    number
  >;
  return result;
}

/** Convert integer calorie shares to rounded gram goals. */
export function calculateMacroGrams(kcal: number, percentages: MacroPercentages): MacroGrams {
  return {
    protein_g: Math.round((kcal * percentages.protein) / 100 / 4),
    carbs_g: Math.round((kcal * percentages.carbs) / 100 / 4),
    fat_g: Math.round((kcal * percentages.fat) / 100 / 9),
  };
}
