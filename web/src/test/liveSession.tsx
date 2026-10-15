import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

import { NetworkError } from "../api/client";
import type { Exercise, Workout, WorkoutExercise, WorkoutSet } from "../api/gym";
import WorkoutPage from "../pages/gym/WorkoutPage";

// Helper per i test della sessione live sul web: fixture, stub di fetch che registra
// le scritture e render di WorkoutPage con gli hook veri (le chiamate HTTP sono quelle di produzione).

export const SQUAT: Exercise = {
  id: 7, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};

export const BENCH: Exercise = {
  id: 8, name: "Panca piana", equipment: "barbell", primary_muscles: ["chest"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};

export const LEG_PRESS: Exercise = {
  id: 9, name: "Leg press", equipment: "machine", primary_muscles: ["quadriceps"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};

const CATALOG: Exercise[] = [LEG_PRESS];

export function workoutSet(id: number, overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return { id, weight_kg: 80, reps: 8, duration_s: null, completed_at: null, previous: null, ...overrides };
}

export function sessionItem(
  id: number,
  exercise: Exercise,
  sets: WorkoutSet[],
  overrides: Partial<WorkoutExercise> = {},
): WorkoutExercise {
  return { id, rest_seconds: 90, superset_group: null, note: null, exercise, sets, ...overrides };
}

/** Allenamento in corso con id di server fissi (workout 5). */
export function liveWorkout(exercises: WorkoutExercise[], overrides: Partial<Workout> = {}): Workout {
  const now = new Date().toISOString();
  return {
    id: 5, name: "Giorno 1", template_id: 2, status: "in_progress",
    started_at: now, finished_at: null, rest_ends_at: null, rest_total_s: null,
    server_now: now, exercises, template_diff: [], ...overrides,
  };
}

export interface SessionRequest {
  method: string;
  path: string;
  body?: unknown;
}

interface SessionApiOptions {
  /** Richieste che falliscono senza risposta, come con la rete assente. */
  networkDown?: (method: string, path: string) => boolean;
}

function reply(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

/** Stub di fetch: GET /workouts/active restituisce l'allenamento, le scritture rispondono con lo stesso
 * allenamento. Registra in `requests` solo le richieste non GET, nell'ordine di invio. */
export function stubSessionApi(workout: Workout, options: SessionApiOptions = {}) {
  const requests: SessionRequest[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^\/api/, "");
    const method = init.method ?? "GET";
    if (method === "GET") {
      return reply(path.startsWith("/exercises") ? { items: CATALOG, total: CATALOG.length } : workout);
    }
    requests.push({ method, path, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    if (options.networkDown?.(method, path)) throw new NetworkError("network");
    return reply(workout);
  }));
  return { requests };
}

/** WorkoutPage con le rotte di uscita (/gym, /gym/history/:id) e una QueryClient nuova. */
export function renderWorkoutPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gym/workout"]}>
        <Routes>
          <Route path="/gym/workout" element={<WorkoutPage />} />
          <Route path="/gym" element={<div>start page</div>} />
          <Route path="/gym/history/:id" element={<div>summary page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
