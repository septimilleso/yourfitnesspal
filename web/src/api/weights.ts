import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { client } from "./client";

export interface Weight {
  id: number;
  date: string;
  weight_kg: number;
}

export interface WeightDay {
  date: string;
  id: number | null;
  weight_kg: number | null;
  avg_7d_kg: number | null;
}

export interface WeightWeek {
  week_start: string;
  avg_kg: number | null;
  count: number;
  change_kg: number | null;
}

export interface WeightHistory {
  start: string;
  end: string;
  days: WeightDay[];
  weeks: WeightWeek[];
}

export const weightKeys = {
  all: ["weight"] as const,
  today: ["weight", "today"] as const,
  range: (start: string, end: string) => ["weight", "range", start, end] as const,
};

export function useTodayWeight(enabled = true) {
  return useQuery({
    queryKey: weightKeys.today,
    queryFn: async () => (await client.get<Weight | undefined>("/weights/today")) ?? null,
    enabled,
  });
}

export function useWeightHistory(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: weightKeys.range(start, end),
    queryFn: () =>
      client.get<WeightHistory>(`/weights?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
    enabled,
  });
}

export function useSaveWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (weight_kg: number) => client.put<Weight>("/weights/today", { weight_kg }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: weightKeys.all }),
  });
}

export function useDeleteWeight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => client.delete<void>(`/weights/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: weightKeys.all }),
  });
}
