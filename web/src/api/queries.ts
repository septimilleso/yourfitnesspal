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
  food_name: string;
  food_brand: string | null;
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

/** Fields common to every food shape the foods endpoints return, and all
 * `QuantityPicker` needs to compute a live macro preview. */
export interface FoodBase {
  id: number;
  name: string;
  brand: string | null;
  image_url: string | null;
  serving_size_g: number | null;
  nutriments: Nutriments;
}

/** A single `GET /api/foods/search` or `GET /api/foods/recent` result.
 * `source` here is a request-scoped UI badge hint ("cache" vs "off"), NOT
 * the food's persisted origin -- see the backend's `FoodSearchItem`
 * docstring. */
export interface FoodSearchItem extends FoodBase {
  barcode: string | null;
  source: "cache" | "off";
}

/** A single `GET /api/foods/barcode/:code` result. `source` here IS the
 * food's persisted origin ("off"/"custom") -- see the backend's `FoodOut`
 * docstring. */
export interface FoodOut extends FoodBase {
  barcode: string | null;
  source: "off" | "custom";
}

interface FoodSearchResponse {
  results: FoodSearchItem[];
}

/** `GET /api/foods/search`. Disabled for an empty/whitespace-only query so
 * the debounced caller in `SearchPage` doesn't fire a request per keystroke
 * before the user has typed anything. */
export function useFoodSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["foods", "search", trimmed] as const,
    queryFn: () =>
      client.get<FoodSearchResponse>(`/foods/search?q=${encodeURIComponent(trimmed)}&limit=20`),
    enabled: trimmed.length > 0,
  });
}

/** `GET /api/foods/recent` -- the "Recenti" tab: foods most recently logged
 * to the diary. */
export function useRecentFoods() {
  return useQuery({
    queryKey: ["foods", "recent"] as const,
    queryFn: () => client.get<FoodSearchResponse>("/foods/recent"),
  });
}

/** `GET /api/foods/barcode/:code`. A mutation (not a query) since it's only
 * triggered on-demand by a scanner decode event, not on mount. */
export function useFoodByBarcode() {
  return useMutation({
    mutationFn: (code: string) => client.get<FoodOut>(`/foods/barcode/${encodeURIComponent(code)}`),
  });
}

export interface CreateEntryInput {
  date: string;
  meal: Meal;
  food_id: number;
  grams: number;
}

/** `POST /api/diary/entries`. Invalidates all cached day-diary queries on
 * success so the Day page reflects the newly-added entry when navigated
 * back to. */
export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEntryInput) => client.post<DiaryEntry>("/diary/entries", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diary", "day"] });
    },
  });
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
