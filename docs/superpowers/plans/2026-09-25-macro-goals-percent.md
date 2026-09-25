# Percent-Based Macro Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set macro targets as integer percentages that total 100%, while displaying calculated grams and preserving the existing grams-based API.

**Architecture:** Add pure helpers for converting saved gram goals to normalized percentages and percentages to gram values. Update `SettingsPage` to edit percentages, show read-only gram previews, validate the sum, and submit the existing API payload shape.

**Tech Stack:** React 18, TypeScript, Vitest, React Testing Library, TanStack Query.

## Global Constraints

- Percentages are integers from 0 through 100 and must total exactly 100.
- Carbohydrates/protein use 4 kcal/g; fat uses 9 kcal/g; gram previews round to nearest integer.
- Normalize existing macro calorie shares with largest remainders; break ties in order carbs, protein, fat.
- Keep `PUT /api/goals` payload and backend schema unchanged.
- Preserve existing card style, separators, spacing, colors, permissions, and result states.

---

### Task 1: Add percentage conversion and update goal form

**Files:**
- Create: `web/src/lib/goalMath.ts`
- Create: `web/src/lib/goalMath.test.ts`
- Modify: `web/src/pages/SettingsPage.tsx`
- Modify: `web/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- `normalizeMacroPercentages(goal: Pick<Goal, "protein_g" | "carbs_g" | "fat_g">): { protein: number | null; carbs: number | null; fat: number | null }`
  - Returns `null` percentages when all macro grams are zero.
  - Otherwise allocates integer percentages by largest remainder, tie order carbs, protein, fat.
- `calculateMacroGrams(kcal: number, percentages: { protein: number; carbs: number; fat: number }): { protein_g: number; carbs_g: number; fat_g: number }`
  - Rounds each macro independently to nearest gram.
- `SettingsPage` keeps kcal editable, edits integer percentages, displays read-only gram previews, blocks submit unless all percentages are valid and total 100, then calls existing mutation with `{ kcal, protein_g, carbs_g, fat_g }`.

- [ ] **Step 1: Write failing helper tests**

In `web/src/lib/goalMath.test.ts`, test that `{ protein_g: 150, carbs_g: 250, fat_g: 70 }` normalizes to `{ protein: 27, carbs: 45, fat: 28 }`; all-zero macros return three `null` values; `calculateMacroGrams(2000, { protein: 35, carbs: 35, fat: 30 })` returns `{ protein_g: 175, carbs_g: 175, fat_g: 67 }`; fractional values round to nearest integer.

- [ ] **Step 2: Run helper tests and confirm failure**

Run from `web/`: `npm test -- --run src/lib/goalMath.test.ts`
Expected: FAIL because `goalMath.ts` does not exist.

- [ ] **Step 3: Write failing page tests**

Update `web/src/pages/SettingsPage.test.tsx` to assert existing goal renders calorie input `2000`, macro percentage inputs `27`, `45`, `28`, and read-only gram previews calculated from those percentages. Add a non-100% case that does not call `mutate` and shows the validation message. Add a valid submit case that sets calorie input to `2200`, percentages to `35`, `35`, `30`, and expects mutation payload `{ kcal: 2200, protein_g: 193, carbs_g: 193, fat_g: 73 }`. Add an all-zero-goal case that leaves percentage inputs empty and blocks submit.

- [ ] **Step 4: Run page tests and confirm failure**

Run from `web/`: `npm test -- --run src/pages/SettingsPage.test.tsx`
Expected: FAIL because page still edits macro grams.

- [ ] **Step 5: Implement pure conversion helpers**

Implement `normalizeMacroPercentages` using macro kcal shares and largest-remainder allocation. For ties, rank remainders by carbs, protein, fat. Return nulls when total macro kcal is zero. Implement `calculateMacroGrams` using divisors 4, 4, and 9 and `Math.round`.

- [ ] **Step 6: Update SettingsPage form**

Use form state for kcal and macro percentage strings. On goal load, normalize saved grams to percentages; preserve blank percentages for all-zero macro goals. Render calorie input as before. Render macro percentage inputs with min `0`, max `100`, and step `1`; put calculated grams beneath each macro label in muted, non-editable text. Keep macro colors, card layout, separators, permission disabling, loading, and save/error states. Show percentage total and validation text unless the three values are integers in range and sum to 100. Prevent mutation unless the form is valid. On submit, calculate grams and pass only existing `kcal`, `protein_g`, `carbs_g`, and `fat_g` fields.

- [ ] **Step 7: Run focused tests**

Run from `web/`: `npm test -- --run src/lib/goalMath.test.ts src/pages/SettingsPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Run complete web test suite and production build**

Run from `web/`: `npm test`
Expected: all tests pass.

Run from `web/`: `npm run build`
Expected: TypeScript check and Vite production build pass.
