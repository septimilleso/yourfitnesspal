import type { QueryClient } from "@tanstack/react-query";

import {
  EMPTY_FILTERS,
  type Exercise,
  type ExerciseFilters,
  type ExerciseList,
  type OfflineSnapshot,
  type Template,
  gymKeys,
} from "../api/gym";

// Esercizi già sul dispositivo per il selettore offline dell'IPA (R14): la pagina del catalogo senza filtri in cache,
// gli esercizi dello snapshot e quelli dei modelli in cache. Nessuna richiesta di rete.
function cachedExercises(queryClient: QueryClient): Exercise[] {
  const catalog = queryClient.getQueryData<ExerciseList>(gymKeys.exercises(EMPTY_FILTERS))?.items ?? [];
  const snapshot =
    queryClient.getQueryData<OfflineSnapshot>(gymKeys.offlineSnapshot)?.exercises.map((item) => item.exercise) ?? [];
  const templates = queryClient
    .getQueriesData<Template>({ queryKey: ["gym", "template"] })
    .flatMap(([, template]) => template?.exercises.map((item) => item.exercise) ?? []);
  return [...catalog, ...snapshot, ...templates];
}

// Stessi criteri del server: nome che contiene il testo (senza maiuscole), attrezzo esatto, muscolo principale.
function matches(exercise: Exercise, filters: ExerciseFilters): boolean {
  const q = filters.q.trim().toLowerCase();
  if (q && !exercise.name.toLowerCase().includes(q)) return false;
  if (filters.equipment && exercise.equipment !== filters.equipment) return false;
  if (filters.muscle && !exercise.primary_muscles.includes(filters.muscle)) return false;
  return true;
}

/** Esercizi già sul dispositivo che corrispondono ai filtri: senza duplicati, in ordine di nome. */
export function localExercises(queryClient: QueryClient, filters: ExerciseFilters = EMPTY_FILTERS): Exercise[] {
  const byId = new Map<number, Exercise>();
  for (const exercise of cachedExercises(queryClient)) {
    if (!byId.has(exercise.id)) byId.set(exercise.id, exercise);
  }
  return [...byId.values()]
    .filter((exercise) => matches(exercise, filters))
    .sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()));
}
