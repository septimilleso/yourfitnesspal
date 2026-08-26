import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client } from "./client";

/** The 4 meal slots a diary entry can belong to. Mirrors the backend's `Meal` enum. */
export type Meal = "breakfast" | "lunch" | "dinner" | "snack";

export const MEALS: Meal[] = ["breakfast", "lunch", "dinner", "snack"];

/** The 8 per-100g nutriment fields a `Food` (and a diary entry's snapshot) carries. */
export interface Nutriments {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  sugars_g: number;
  fat_g: number;
  sat_fat_g: number;
  fiber_g: number;
  salt_g: number;
}

export interface DiaryEntry {
  id: number;
  food_id: number;
  date: string;
  meal: Meal;
  grams: number;
  portion_label: string | null;
  position: number;
  /** Full per-100g nutriment dict, NOT pre-scaled by `grams` -- scale by
   * `grams / 100` when displaying computed values for this entry. */
  nutriments_snapshot: Nutriments;
}

export interface DayTotals {
  by_meal: Record<string, Nutriments>;
  total: Nutriments;
}

export interface Goal {
  id: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  valid_from: string;
}

/** `goal - day_total` for the 4 fields a `Goal` tracks. Positive means room
 * left, negative means over goal. */
export interface GoalDelta {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface DayResponse {
  date: string;
  entries: Record<Meal, DiaryEntry[]>;
  totals: DayTotals;
  goal: Goal | null;
  delta: GoalDelta | null;
}

function dayDiaryQueryKey(date: string) {
  return ["diary", "day", date] as const;
}

/** `GET /api/diary/day/:date`. */
export function useDayDiary(date: string) {
  return useQuery({
    queryKey: dayDiaryQueryKey(date),
    queryFn: () => client.get<DayResponse>(`/diary/day/${date}`),
  });
}

/** `DELETE /api/diary/entries/:id`. Invalidates all cached day-diary queries
 * on success/error alike (the mutation doesn't know which date the deleted
 * entry belonged to, so it can't target a single query key). */
export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: number) => client.delete<void>(`/diary/entries/${entryId}`),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["diary", "day"] });
    },
  });
}

export interface PatchEntryInput {
  id: number;
  grams?: number;
  meal?: Meal;
}

/** `PATCH /api/diary/entries/:id`. Invalidates all cached day-diary queries
 * on success/error alike -- same rationale as `useDeleteEntry`. */
export function usePatchEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: PatchEntryInput) =>
      client.patch<DiaryEntry>(`/diary/entries/${id}`, body),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["diary", "day"] });
    },
  });
}
