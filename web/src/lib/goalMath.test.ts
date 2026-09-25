import { describe, expect, it } from "vitest";

import { calculateMacroGrams, normalizeMacroPercentages } from "./goalMath";

describe("normalizeMacroPercentages", () => {
  it("preserves existing macro calorie proportions and totals 100", () => {
    expect(normalizeMacroPercentages({ protein_g: 150, carbs_g: 250, fat_g: 70 })).toEqual({
      protein: 27,
      carbs: 45,
      fat: 28,
    });
  });

  it("returns empty percentages when all macros are zero", () => {
    expect(normalizeMacroPercentages({ protein_g: 0, carbs_g: 0, fat_g: 0 })).toEqual({
      protein: null,
      carbs: null,
      fat: null,
    });
  });
});

describe("calculateMacroGrams", () => {
  it("calculates grams from calorie percentages", () => {
    expect(calculateMacroGrams(2000, { protein: 35, carbs: 35, fat: 30 })).toEqual({
      protein_g: 175,
      carbs_g: 175,
      fat_g: 67,
    });
  });

  it("rounds each result to the nearest gram", () => {
    expect(calculateMacroGrams(201, { protein: 33, carbs: 33, fat: 34 })).toEqual({
      protein_g: 17,
      carbs_g: 17,
      fat_g: 8,
    });
  });
});
