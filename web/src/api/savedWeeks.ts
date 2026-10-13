import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { retryNative } from "../lib/retry";
import { isNative } from "../native/platform";
import { client } from "./client";
import type { CopyDaysResponse, Meal, Nutriments } from "./queries";

export interface SavedWeekSummary {
  id: number;
  name: string;
  created_at: string;
  entries_count: number;
  avg_kcal: number;
}

export interface SavedWeekItem {
  id: number;
  food_id: number;
  food_name: string;
  food_brand: string | null;
  grams: number;
  portion_label: string | null;
  position: number;
}

export interface SavedWeekDay {
  day_index: number;
  meals: Record<Meal, SavedWeekItem[]>;
  total: Nutriments;
}

export interface SavedWeekDetail extends SavedWeekSummary {
  days: SavedWeekDay[];
}

export interface SaveWeekInput {
  name: string;
  start: string;
}

export interface RenameSavedWeekInput {
  id: number;
  name: string;
}

export interface ApplySavedWeekInput {
  id: number;
  days: number[] | null;
  target_start: string;
  meals: Meal[] | null;
  mode: "append" | "replace";
}

export const savedWeekKeys = {
  all: ["saved-weeks"] as const,
  list: ["saved-weeks", "list"] as const,
  detail: (id: number) => ["saved-weeks", "detail", id] as const,
};

export function fetchSavedWeeks() {
  return client.get<SavedWeekSummary[]>("/saved-weeks");
}

export function fetchSavedWeek(id: number) {
  return client.get<SavedWeekDetail>(`/saved-weeks/${id}`);
}

export function useSavedWeeks() {
  return useQuery({
    queryKey: savedWeekKeys.list,
    queryFn: () => fetchSavedWeeks(),
  });
}

export function useSavedWeek(id: number) {
  return useQuery({
    queryKey: savedWeekKeys.detail(id),
    queryFn: () => fetchSavedWeek(id),
    retry: isNative() ? retryNative : false,
  });
}

export function useSaveWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveWeekInput) => client.post<SavedWeekSummary>("/saved-weeks", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedWeekKeys.all }),
  });
}

export function useRenameSavedWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: RenameSavedWeekInput) =>
      client.patch<SavedWeekSummary>(`/saved-weeks/${id}`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedWeekKeys.all }),
  });
}

export function useDeleteSavedWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => client.delete<void>(`/saved-weeks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: savedWeekKeys.all }),
  });
}

export function useApplySavedWeek() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ApplySavedWeekInput) =>
      client.post<CopyDaysResponse>(`/saved-weeks/${id}/apply`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diary", "week"] });
      queryClient.invalidateQueries({ queryKey: ["diary", "day"] });
    },
  });
}
