// Reducer puro della sessione di allenamento: serie e riposo. Stesse regole e stessi
// messaggi del server (`set_problem`, `rest_after_completion`, `rest_action`), portati
// in `gymRules.ts`. Nessun orologio né generatore di UUID interni: arrivano da `deps`.
import type { SetValues, Tracking } from "../api/gym";
import {
  type ExerciseProgress,
  NoRestTimerError,
  type WorkoutStatus,
  isoOffset,
  nextSetValues,
  restAction,
  restAfterCompletion,
  roundKg,
  setProblem,
} from "./gymRules";

export interface SessionSet extends SetValues {
  uuid: string;
  /** Id del server; null finché il server non ha visto la serie. */
  id: number | null;
  completed_at: string | null;
}

export interface SessionExercise {
  uuid: string;
  id: number | null;
  exercise_id: number;
  name: string;
  tracking: Tracking;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: SessionSet[];
}

/** Allenamento in sessione, con i campi di `PUT /api/workouts/{uuid}` in forma wire. */
export interface SessionWorkout {
  uuid: string;
  id: number | null;
  /** Ultima versione nota del server; il reducer non la cambia. */
  version: number | null;
  name: string;
  template_id: number | null;
  status: WorkoutStatus;
  started_at: string;
  finished_at: string | null;
  rest_ends_at: string | null;
  rest_total_s: number | null;
  exercises: SessionExercise[];
}

export type SessionAction =
  | { type: "patchSet"; setUuid: string; values: SetValues }
  | { type: "completeSet"; setUuid: string; values: SetValues }
  | { type: "uncompleteSet"; setUuid: string }
  | { type: "addSet"; exerciseUuid: string; previousFirst: SetValues | null }
  | { type: "deleteSet"; setUuid: string }
  | { type: "restStart"; seconds: number }
  | { type: "restDelta"; seconds: number }
  | { type: "restSkip" };

export interface SessionDeps {
  /** Ms epoch sull'orologio del server stimato. */
  now: number;
  /** Generatore di UUID v4 per le serie nuove. */
  uuid: () => string;
}

export type SessionResult =
  | { ok: true; state: SessionWorkout }
  /** `error` è il messaggio del server; `state` è lo stato di prima, lo stesso riferimento. */
  | { ok: false; error: string; state: SessionWorkout };

/** Stesso testo del server (`Invalid` → 400) o del 422 che `liveErrorMessage` traduce in "Valori non validi". */
const VALUES_INVALID = "Valori non validi";

class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

function cleanValues(values: SetValues): SetValues {
  return {
    weight_kg: roundKg(values.weight_kg ?? null),
    reps: values.reps ?? null,
    duration_s: values.duration_s ?? null,
  };
}

// Stessi limiti di `SetValues` del server (0–1000 kg e ripetizioni, 0–36000 s).
function valuesOutOfRange(values: SetValues): boolean {
  const { weight_kg: kg, reps, duration_s: seconds } = values;
  return (
    (kg !== null && !(kg >= 0 && kg <= 1000)) ||
    (reps !== null && !(Number.isInteger(reps) && reps >= 0 && reps <= 1000)) ||
    (seconds !== null && !(Number.isInteger(seconds) && seconds >= 0 && seconds <= 36000))
  );
}

function isIntegerIn(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

/** Limiti di `RestIn` del server, controllati prima di ogni altra regola (come lo schema). */
function checkInput(action: SessionAction): void {
  if (action.type === "patchSet" || action.type === "completeSet") {
    if (valuesOutOfRange(cleanValues(action.values))) throw new SessionError(VALUES_INVALID);
  } else if (action.type === "restStart") {
    if (!isIntegerIn(action.seconds, 1, 600)) throw new SessionError(VALUES_INVALID);
  } else if (action.type === "restDelta") {
    if (!isIntegerIn(action.seconds, -600, 600)) throw new SessionError(VALUES_INVALID);
  }
}

function locateSet(state: SessionWorkout, setUuid: string): [number, number] {
  for (let e = 0; e < state.exercises.length; e += 1) {
    const s = state.exercises[e].sets.findIndex((set) => set.uuid === setUuid);
    if (s !== -1) return [e, s];
  }
  throw new SessionError("set not found");
}

function locateExercise(state: SessionWorkout, exerciseUuid: string): number {
  const e = state.exercises.findIndex((exercise) => exercise.uuid === exerciseUuid);
  if (e === -1) throw new SessionError("exercise not found");
  return e;
}

function replaceAt<T>(items: readonly T[], index: number, item: T): T[] {
  return items.map((existing, i) => (i === index ? item : existing));
}

function updateSets(state: SessionWorkout, exerciseIndex: number, sets: SessionSet[]): SessionWorkout {
  return {
    ...state,
    exercises: replaceAt(state.exercises, exerciseIndex, { ...state.exercises[exerciseIndex], sets }),
  };
}

/** Posizioni e serie fatte di un esercizio, nel formato di `restAfterCompletion`. */
function progressOf(exercise: SessionExercise): ExerciseProgress {
  return {
    rest_seconds: exercise.rest_seconds,
    superset_group: exercise.superset_group,
    set_positions: exercise.sets.map((_, index) => index),
    completed_positions: exercise.sets.flatMap((set, index) => (set.completed_at === null ? [] : [index])),
  };
}

function withRest(state: SessionWorkout, timer: { ends_at: string | null; total_s: number | null }): SessionWorkout {
  return { ...state, rest_ends_at: timer.ends_at, rest_total_s: timer.total_s };
}

function apply(state: SessionWorkout, action: SessionAction, deps: SessionDeps): SessionWorkout {
  checkInput(action);
  if (state.status !== "in_progress") throw new SessionError("workout is not in progress");
  const { now, uuid } = deps;

  switch (action.type) {
    case "patchSet": {
      const [e, s] = locateSet(state, action.setUuid);
      const exercise = state.exercises[e];
      const next = { ...exercise.sets[s], ...cleanValues(action.values) };
      if (next.completed_at !== null) {
        const problem = setProblem(exercise.tracking, next.weight_kg, next.reps, next.duration_s);
        if (problem) throw new SessionError(problem);
      }
      return updateSets(state, e, replaceAt(exercise.sets, s, next));
    }

    case "completeSet": {
      const [e, s] = locateSet(state, action.setUuid);
      const exercise = state.exercises[e];
      const values = cleanValues(action.values);
      const problem = setProblem(exercise.tracking, values.weight_kg, values.reps, values.duration_s);
      if (problem) throw new SessionError(problem);
      const set = exercise.sets[s];
      const next = updateSets(
        state,
        e,
        replaceAt(exercise.sets, s, { ...set, ...values, completed_at: set.completed_at ?? isoOffset(now) }),
      );
      // Il riposo parte solo per una serie appena completata, come `complete_set` sul server.
      if (set.completed_at !== null) return next;
      const rest = restAfterCompletion(next.exercises.map(progressOf), e, s);
      if (rest === null) return next;
      return { ...next, rest_ends_at: isoOffset(now + rest * 1000), rest_total_s: rest };
    }

    case "uncompleteSet": {
      const [e, s] = locateSet(state, action.setUuid);
      const exercise = state.exercises[e];
      return updateSets(state, e, replaceAt(exercise.sets, s, { ...exercise.sets[s], completed_at: null }));
    }

    case "addSet": {
      const e = locateExercise(state, action.exerciseUuid);
      const sets = state.exercises[e].sets;
      const last = sets.length > 0 ? sets[sets.length - 1] : null;
      const previousFirst = action.previousFirst === null ? null : cleanValues(action.previousFirst);
      // Si leggono i campi uno a uno: `last` porta uuid e completed_at che non vanno copiati.
      const chosen = nextSetValues(last, previousFirst);
      const set: SessionSet = {
        uuid: uuid(),
        id: null,
        weight_kg: chosen.weight_kg,
        reps: chosen.reps,
        duration_s: chosen.duration_s,
        completed_at: null,
      };
      return updateSets(state, e, [...sets, set]);
    }

    case "deleteSet": {
      const [e, s] = locateSet(state, action.setUuid);
      // Le posizioni sono l'indice nell'array: togliere una serie le rinumera da sola.
      return updateSets(state, e, state.exercises[e].sets.filter((_, index) => index !== s));
    }

    case "restStart":
      return withRest(
        state,
        restAction(now, state.rest_ends_at, state.rest_total_s, { startS: action.seconds }),
      );

    case "restDelta":
      return withRest(
        state,
        restAction(now, state.rest_ends_at, state.rest_total_s, { deltaS: action.seconds }),
      );

    case "restSkip":
      return withRest(state, restAction(now, state.rest_ends_at, state.rest_total_s, { skip: true }));
  }
}

/** Applica un'azione della sessione. Un'azione non valida restituisce il messaggio del server e lo stato invariato. */
export function reduceSession(state: SessionWorkout, action: SessionAction, deps: SessionDeps): SessionResult {
  try {
    return { ok: true, state: apply(state, action, deps) };
  } catch (error) {
    if (error instanceof SessionError || error instanceof NoRestTimerError) {
      return { ok: false, error: error.message, state };
    }
    throw error;
  }
}
