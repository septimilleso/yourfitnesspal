import { useContext } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { liveErrorMessage } from "../lib/gym";
import { LiveErrorContext } from "../lib/liveErrors";
import { ApiError, client } from "./client";

/** What a set of an exercise records. Mirrors the backend's `Tracking` enum. */
export type Tracking = "weight_reps" | "reps" | "duration";

export interface Exercise {
  id: number;
  name: string;
  equipment: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  category: string | null;
  tracking: Tracking;
  custom: boolean;
}

export interface ExerciseDetail extends Exercise {
  instructions: string[];
}

export interface ExerciseList {
  items: Exercise[];
  total: number;
}

export interface ExerciseInput {
  name: string;
  equipment: string | null;
  primary_muscle: string | null;
  tracking: Tracking;
}

export interface ExerciseFilters {
  q: string;
  equipment: string;
  muscle: string;
}

export const EMPTY_FILTERS: ExerciseFilters = { q: "", equipment: "", muscle: "" };

export interface SetValues {
  weight_kg: number | null;
  reps: number | null;
  duration_s: number | null;
}

export interface TemplateExercise {
  id: number;
  exercise: Exercise;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: SetValues[];
}

export interface Template {
  id: number;
  name: string;
  folder_id: number | null;
  last_used_at: string | null;
  exercises: TemplateExercise[];
}

export interface TemplateSummary {
  id: number;
  name: string;
  folder_id: number | null;
  last_used_at: string | null;
  exercise_names: string[];
}

export interface Folder {
  id: number;
  name: string;
  position: number;
}

export interface TemplatesResponse {
  folders: Folder[];
  templates: TemplateSummary[];
}

export interface TemplateExerciseInput {
  exercise_id: number;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: SetValues[];
}

export interface TemplateInput {
  name: string;
  folder_id: number | null;
  exercises: TemplateExerciseInput[];
}

export interface WorkoutSet extends SetValues {
  id: number;
  completed_at: string | null;
  /** Same position in the last finished workout with this exercise. */
  previous: SetValues | null;
  /** Best set value for this position; absent or null means no maximum. */
  max_set?: SetValues | null;
}

export interface WorkoutExercise {
  id: number;
  exercise: Exercise;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: WorkoutSet[];
}

export interface Workout {
  id: number;
  name: string;
  template_id: number | null;
  status: "in_progress" | "finished";
  started_at: string;
  finished_at: string | null;
  rest_ends_at: string | null;
  rest_total_s: number | null;
  /** Server clock when the response was built: used to correct the phone's clock. */
  server_now: string;
  exercises: WorkoutExercise[];
  /** Finished workouts made from a template: readable differences from it. */
  template_diff: string[];
}

export interface HistoryItem {
  id: number;
  name: string;
  started_at: string;
  finished_at: string;
  exercises: { name: string; sets: number }[];
}

export interface HistoryPage {
  items: HistoryItem[];
  next_before: string | null;
}

export interface GymCount {
  finished: number;
}

export interface GymWeek {
  week_start: string;
  workouts: number;
}

export interface GymStats {
  start: string;
  end: string;
  workouts: number;
  volume_kg: number;
  avg_duration_min: number | null;
  weeks: GymWeek[];
}

export interface PerformedExercise {
  exercise_id: number;
  name: string;
  tracking: Tracking;
  custom: boolean;
  last_date: string;
}

export interface ProgressSession {
  date: string;
  workout_id: number;
  metrics: Record<string, number>;
  sets: string[];
}

export interface PersonalRecord {
  kind: string;
  value: number;
  date: string;
}

export interface ExerciseProgress {
  exercise_id: number;
  name: string;
  tracking: Tracking;
  start: string;
  end: string;
  sessions: ProgressSession[];
  records: PersonalRecord[];
}

export interface LayoutItem {
  id: number;
  superset_group: number | null;
}

export type RestAction = { start_s: number } | { delta_s: number } | { skip: true };

export const gymKeys = {
  exercises: (filters: ExerciseFilters) => ["gym", "exercises", filters] as const,
  exercise: (id: number) => ["gym", "exercise", id] as const,
  templates: ["gym", "templates"] as const,
  template: (id: number) => ["gym", "template", id] as const,
  active: ["gym", "workout", "active"] as const,
  workout: (id: number) => ["gym", "workout", id] as const,
  history: ["gym", "history"] as const,
  statsCount: ["gym", "stats", "count"] as const,
  stats: (start: string, end: string) => ["gym", "stats", "range", start, end] as const,
  statsExercises: ["gym", "stats", "exercises"] as const,
  progress: (id: number, start: string, end: string) =>
    ["gym", "stats", "progress", id, start, end] as const,
};

function exercisesPath(filters: ExerciseFilters): string {
  const params = new URLSearchParams({ limit: "200" });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.equipment) params.set("equipment", filters.equipment);
  if (filters.muscle) params.set("muscle", filters.muscle);
  return `/exercises?${params.toString()}`;
}

// ---- exercises ----

export function fetchExercises(filters: ExerciseFilters) {
  return client.get<ExerciseList>(exercisesPath(filters));
}

export function useExercises(filters: ExerciseFilters) {
  return useQuery({
    queryKey: gymKeys.exercises(filters),
    queryFn: () => fetchExercises(filters),
    placeholderData: (previous) => previous,
  });
}

export function useExercise(id: number | null) {
  return useQuery({
    queryKey: gymKeys.exercise(id ?? 0),
    queryFn: () => client.get<ExerciseDetail>(`/exercises/${id}`),
    enabled: id !== null,
  });
}

export function useCreateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ExerciseInput) => client.post<ExerciseDetail>("/exercises", input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gym", "exercises"] }),
  });
}

export function useUpdateExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ExerciseInput & { id: number }) =>
      client.patch<ExerciseDetail>(`/exercises/${id}`, input),
    onSuccess: (exercise) => {
      queryClient.setQueryData(gymKeys.exercise(exercise.id), exercise);
      void queryClient.invalidateQueries({ queryKey: ["gym", "exercises"] });
    },
  });
}

export function useArchiveExercise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => client.delete<void>(`/exercises/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["gym", "exercises"] }),
  });
}

// ---- templates and folders ----

export function fetchTemplates() {
  return client.get<TemplatesResponse>("/templates");
}

export function fetchTemplate(id: number) {
  return client.get<Template>(`/templates/${id}`);
}

export function useTemplates() {
  return useQuery({
    queryKey: gymKeys.templates,
    queryFn: () => fetchTemplates(),
  });
}

export function useTemplate(id: number | null) {
  return useQuery({
    queryKey: gymKeys.template(id ?? 0),
    queryFn: () => fetchTemplate(id ?? 0),
    enabled: id !== null,
  });
}

function useTemplateMutation<V, R>(mutationFn: (variables: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gymKeys.templates });
      void queryClient.invalidateQueries({ queryKey: ["gym", "template"] });
    },
  });
}

export const useCreateTemplate = () =>
  useTemplateMutation((input: TemplateInput) => client.post<Template>("/templates", input));

export const useReplaceTemplate = () =>
  useTemplateMutation(({ id, input }: { id: number; input: TemplateInput }) =>
    client.put<Template>(`/templates/${id}`, input),
  );

export const usePatchTemplate = () =>
  useTemplateMutation(
    ({ id, ...patch }: { id: number; name?: string; folder_id?: number | null }) =>
      client.patch<Template>(`/templates/${id}`, patch),
  );

export const useDeleteTemplate = () =>
  useTemplateMutation((id: number) => client.delete<void>(`/templates/${id}`));

export const useDuplicateTemplate = () =>
  useTemplateMutation((id: number) => client.post<Template>(`/templates/${id}/duplicate`));

export const useCreateFolder = () =>
  useTemplateMutation((name: string) => client.post<Folder>("/template-folders", { name }));

export const useRenameFolder = () =>
  useTemplateMutation(({ id, name }: { id: number; name: string }) =>
    client.patch<Folder>(`/template-folders/${id}`, { name }),
  );

export const useDeleteFolder = () =>
  useTemplateMutation((id: number) => client.delete<void>(`/template-folders/${id}`));

// ---- workouts ----

export function useActiveWorkout(enabled = true) {
  return useQuery({
    queryKey: gymKeys.active,
    // 204 (no live workout) comes back as `undefined`; react-query needs null.
    queryFn: async () => (await client.get<Workout | undefined>("/workouts/active")) ?? null,
    enabled,
  });
}

export function fetchWorkout(id: number) {
  return client.get<Workout>(`/workouts/${id}`);
}

export function useWorkout(id: number) {
  return useQuery({
    queryKey: gymKeys.workout(id),
    queryFn: () => fetchWorkout(id),
  });
}

interface WorkoutRef {
  workoutId: number;
}

/** Every live-session endpoint; each answers with the whole workout. */
export const gymApi = {
  renameWorkout: ({ workoutId, name }: WorkoutRef & { name: string }) =>
    client.patch<Workout>(`/workouts/${workoutId}`, { name }),
  addExercise: ({ workoutId, exerciseId }: WorkoutRef & { exerciseId: number }) =>
    client.post<Workout>(`/workouts/${workoutId}/exercises`, { exercise_id: exerciseId }),
  patchExercise: ({
    workoutId,
    id,
    ...body
  }: WorkoutRef & { id: number; exercise_id?: number; rest_seconds?: number; note?: string | null }) =>
    client.patch<Workout>(`/workouts/${workoutId}/exercises/${id}`, body),
  removeExercise: ({ workoutId, id }: WorkoutRef & { id: number }) =>
    client.delete<Workout>(`/workouts/${workoutId}/exercises/${id}`),
  setLayout: ({ workoutId, items }: WorkoutRef & { items: LayoutItem[] }) =>
    client.put<Workout>(`/workouts/${workoutId}/layout`, { items }),
  addSet: ({ workoutId, exerciseId }: WorkoutRef & { exerciseId: number }) =>
    client.post<Workout>(`/workouts/${workoutId}/exercises/${exerciseId}/sets`),
  patchSet: ({ workoutId, id, values }: WorkoutRef & { id: number; values: SetValues }) =>
    client.patch<Workout>(`/workouts/${workoutId}/sets/${id}`, values),
  deleteSet: ({ workoutId, id }: WorkoutRef & { id: number }) =>
    client.delete<Workout>(`/workouts/${workoutId}/sets/${id}`),
  completeSet: ({ workoutId, id, values }: WorkoutRef & { id: number; values: SetValues }) =>
    client.post<Workout>(`/workouts/${workoutId}/sets/${id}/complete`, values),
  uncompleteSet: ({ workoutId, id }: WorkoutRef & { id: number }) =>
    client.post<Workout>(`/workouts/${workoutId}/sets/${id}/uncomplete`),
  rest: ({ workoutId, action }: WorkoutRef & { action: RestAction }) =>
    client.post<Workout>(`/workouts/${workoutId}/rest`, action),
};

/** A live-session edit: runs in the single "live-workout" queue (so responses
 * land in the order the edits were made), retries network failures, writes
 * the returned workout into the cache and reports errors to the page. */
export function useLiveMutation<V>(mutationFn: (variables: V) => Promise<Workout>) {
  const queryClient = useQueryClient();
  const report = useContext(LiveErrorContext);
  return useMutation({
    mutationFn,
    scope: { id: "live-workout" },
    retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 2,
    onSuccess: (workout) => queryClient.setQueryData(gymKeys.active, workout),
    onError: (error) => report(liveErrorMessage(error)),
  });
}

export function useStartWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: number | null) =>
      client.post<Workout>("/workouts", { template_id: templateId }),
    onSuccess: (workout) => {
      queryClient.setQueryData(gymKeys.active, workout);
      void queryClient.invalidateQueries({ queryKey: gymKeys.templates });
    },
  });
}

export function useFinishWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workoutId, discardIncomplete }: WorkoutRef & { discardIncomplete: boolean }) =>
      client.post<Workout>(`/workouts/${workoutId}/finish`, {
        discard_incomplete: discardIncomplete,
      }),
    // Same queue as the live edits: pending set saves reach the server first.
    scope: { id: "live-workout" },
    onSuccess: (workout) => {
      queryClient.setQueryData(gymKeys.active, null);
      queryClient.setQueryData(gymKeys.workout(workout.id), workout);
      void queryClient.invalidateQueries({ queryKey: gymKeys.history });
      void queryClient.invalidateQueries({ queryKey: ["gym", "stats"] });
    },
  });
}

export function useCancelWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workoutId: number) => client.delete<void>(`/workouts/${workoutId}`),
    scope: { id: "live-workout" },
    onSuccess: () => queryClient.setQueryData(gymKeys.active, null),
  });
}

/** One page of finished workouts; `before` is the `next_before` of the previous page. */
export function fetchHistoryPage(before: string | null) {
  return client.get<HistoryPage>(
    `/workouts?limit=20${before ? `&before=${encodeURIComponent(before)}` : ""}`,
  );
}

export function useHistory() {
  return useInfiniteQuery({
    queryKey: gymKeys.history,
    queryFn: ({ pageParam }) => fetchHistoryPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before,
  });
}

export function fetchGymCount() {
  return client.get<GymCount>("/stats/gym/count");
}

export function useGymCount() {
  return useQuery({
    queryKey: gymKeys.statsCount,
    queryFn: () => fetchGymCount(),
  });
}

export function fetchGymStats(start: string, end: string) {
  return client.get<GymStats>(`/stats/gym?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
}

export function useGymStats(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: gymKeys.stats(start, end),
    queryFn: () => fetchGymStats(start, end),
    enabled,
  });
}

export function fetchPerformedExercises() {
  return client.get<PerformedExercise[]>("/stats/gym/exercises");
}

export function usePerformedExercises() {
  return useQuery({
    queryKey: gymKeys.statsExercises,
    queryFn: () => fetchPerformedExercises(),
  });
}

export function fetchExerciseProgress(id: number, start: string, end: string) {
  return client.get<ExerciseProgress>(
    `/stats/gym/exercises/${id}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
  );
}

export function useExerciseProgress(id: number, start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: gymKeys.progress(id, start, end),
    queryFn: () => fetchExerciseProgress(id, start, end),
    enabled,
  });
}

function useWorkoutTemplateMutation<V>(mutationFn: (variables: V) => Promise<Template>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gymKeys.templates });
      void queryClient.invalidateQueries({ queryKey: ["gym", "template"] });
      void queryClient.invalidateQueries({ queryKey: ["gym", "workout"] });
    },
  });
}

export const useApplyToTemplate = () =>
  useWorkoutTemplateMutation((workoutId: number) =>
    client.post<Template>(`/workouts/${workoutId}/apply-to-template`),
  );

export const useSaveAsTemplate = () =>
  useWorkoutTemplateMutation(({ workoutId, name }: WorkoutRef & { name: string }) =>
    client.post<Template>(`/workouts/${workoutId}/save-as-template`, { name }),
  );

export function useDeleteWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workoutId: number) => client.delete<void>(`/workouts/${workoutId}`),
    onSuccess: (_data, workoutId) => {
      queryClient.removeQueries({ queryKey: gymKeys.workout(workoutId) });
      void queryClient.invalidateQueries({ queryKey: gymKeys.history });
      void queryClient.invalidateQueries({ queryKey: ["gym", "stats"] });
    },
  });
}
