// Sessione di allenamento dell'IPA (C17–C21): lo stato locale dello store letto e modificato dalla UI.
// Ogni operazione è un dispatch sull'allenamento attivo, senza richieste di rete. Nel browser
// `useActiveSession` resta `useActiveWorkout` e la sessione è `useServerSession`.
import { useQuery } from "@tanstack/react-query";
import { useContext, useSyncExternalStore } from "react";

import {
  type Exercise,
  type OfflineSnapshot,
  type Template,
  type Workout,
  type WorkoutExercise,
  fetchOfflineSnapshot,
  gymKeys,
  useActiveWorkout,
} from "../api/gym";
import { liveErrorText } from "../lib/gym";
import { isoOffset } from "../lib/gymRules";
import {
  type PreviousAndMax,
  type SessionAction,
  type SessionExercise,
  previousAndMax,
  previousFirst,
} from "../lib/gymSession";
import { LiveErrorContext } from "../lib/liveErrors";
import type { LiveSession } from "../lib/liveSession";
import {
  type GymEntry,
  dispatch,
  getSnapshot,
  startEmptyWorkout,
  startWorkoutFromTemplate,
  subscribe,
} from "./gymStore";
import { isNative } from "./platform";

/** Allenamento attivo per la UI: `data` è null se non c'è, undefined mentre il web lo carica. */
export interface ActiveSession {
  data: Workout | null | undefined;
  isLoading: boolean;
  isError: boolean;
  isPlaceholderData?: boolean;
  fetchStatus?: string;
}

// Termina e Annulla nell'IPA arrivano con T25 e T27: fino ad allora rispondono con un errore, senza cambiare nulla.
const NOT_YET_LOCAL = "Non ancora disponibile nell'app";

// Campi che lo snapshot non porta: un esercizio fuori dallo snapshot ha solo nome, tracking e id.
const BLANK_EXERCISE: Omit<Exercise, "id" | "name" | "tracking"> = {
  equipment: null,
  primary_muscles: [],
  secondary_muscles: [],
  category: null,
  custom: false,
};

// Id del server che l'allenamento o l'esercizio non hanno ancora: la UI li riconosce per uuid, quindi 0 è un segnaposto.
const UNSENT_ID = 0;

function exerciseView(
  exercise: SessionExercise,
  snapshot: OfflineSnapshot | null,
  marks: Map<string, PreviousAndMax>,
): WorkoutExercise {
  const known = snapshot?.exercises.find((item) => item.exercise.id === exercise.exercise_id)?.exercise;
  return {
    id: exercise.id ?? UNSENT_ID,
    uuid: exercise.uuid,
    exercise: { ...BLANK_EXERCISE, ...known, id: exercise.exercise_id, name: exercise.name, tracking: exercise.tracking },
    rest_seconds: exercise.rest_seconds,
    superset_group: exercise.superset_group,
    note: exercise.note,
    sets: exercise.sets.map((set) => {
      const mark = marks.get(set.uuid);
      return {
        id: set.id ?? UNSENT_ID,
        uuid: set.uuid,
        weight_kg: set.weight_kg,
        reps: set.reps,
        duration_s: set.duration_s,
        completed_at: set.completed_at,
        previous: mark?.previous ?? null,
        max_set: mark?.max ?? null,
      };
    }),
  };
}

/**
 * Lo stato locale nella forma che la UI legge da `GET /workouts/active`. Precedente e Max vengono da
 * `previousAndMax` (ultima risposta del server o snapshot). `server_now` è l'orologio del telefono corretto
 * con lo scarto noto.
 */
function workoutView(entry: GymEntry, snapshot: OfflineSnapshot | null, clockOffsetMs: number): Workout {
  const { workout } = entry;
  const marks = previousAndMax(entry, snapshot);
  return {
    id: workout.id ?? UNSENT_ID,
    uuid: workout.uuid,
    version: workout.version ?? undefined,
    name: workout.name,
    template_id: workout.template_id,
    status: workout.status,
    started_at: workout.started_at,
    finished_at: workout.finished_at,
    rest_ends_at: workout.rest_ends_at,
    rest_total_s: workout.rest_total_s,
    server_now: isoOffset(Date.now() + clockOffsetMs),
    exercises: workout.exercises.map((exercise) => exerciseView(exercise, snapshot, marks)),
    template_diff: [],
  };
}

interface LocalState {
  entry: GymEntry | null;
  snapshot: OfflineSnapshot | null;
  clockOffsetMs: number;
}

// Stato dello store e snapshot in cache. La query è disattivata: legge la cache e non fa richieste.
function useLocalState(): LocalState {
  const store = useSyncExternalStore(subscribe, getSnapshot);
  const snapshot = useQuery({ queryKey: gymKeys.offlineSnapshot, queryFn: fetchOfflineSnapshot, enabled: false }).data;
  return { entry: store.active, snapshot: snapshot ?? null, clockOffsetMs: store.clockOffsetMs };
}

function useLocalActive(): ActiveSession {
  const { entry, snapshot, clockOffsetMs } = useLocalState();
  const data = entry === null ? null : workoutView(entry, snapshot, clockOffsetMs);
  return { data, isLoading: false, isError: false, isPlaceholderData: false };
}

function useServerActive(): ActiveSession {
  return useActiveWorkout();
}

/**
 * Allenamento attivo per la UI: nell'IPA dallo stato locale, nel browser `useActiveWorkout` come prima.
 * La piattaforma non cambia mentre l'app gira: il ramo è sempre lo stesso, quindi gli hook restano nello stesso ordine.
 */
export function useActiveSession(): ActiveSession {
  return isNative() ? useLocalActive() : useServerActive();
}

/** Avvio nell'IPA: un dispatch sullo store, senza rete. Restituisce il messaggio d'errore, o null se è partito. */
export function startLocalWorkout(template: Template | null): string | null {
  const outcome = template === null ? startEmptyWorkout() : startWorkoutFromTemplate(template);
  return outcome.ok ? null : outcome.error;
}

/**
 * Sessione locale per la pagina: ogni operazione è un'azione del reducer sull'allenamento attivo. Un errore del
 * reducer va al toast con `liveErrorText`. Null se non c'è un allenamento attivo.
 */
export function useLocalSession(): LiveSession | null {
  const report = useContext(LiveErrorContext);
  const { entry, snapshot, clockOffsetMs } = useLocalState();
  if (entry === null) return null;

  const uuid = entry.workout.uuid;
  const previousFirstOf = (exerciseUuid: string) => {
    const exercise = entry.workout.exercises.find((item) => item.uuid === exerciseUuid);
    return exercise ? previousFirst(exercise.exercise_id, snapshot) : null;
  };
  function act(action: SessionAction): void {
    const result = dispatch(uuid, action);
    if (!result.ok) report(liveErrorText(result.error));
  }

  return {
    workout: workoutView(entry, snapshot, clockOffsetMs),
    clockOffsetMs,
    isFinishing: false,
    isCancelling: false,

    rename: (name) => act({ type: "rename", name }),
    addExercises: (exercises) => act({ type: "addExercises", exercises, snapshot }),
    replaceExercise: (exerciseUuid, exercise) => act({ type: "replaceExercise", exerciseUuid, exercise }),
    removeExercise: (exerciseUuid) => act({ type: "removeExercise", exerciseUuid }),
    setNote: (exerciseUuid, note) => act({ type: "setNote", exerciseUuid, note }),
    setRest: (exerciseUuid, seconds) => act({ type: "setRest", exerciseUuid, seconds }),
    setLayout: (layout) => act({ type: "setLayout", layout }),
    addSet: (exerciseUuid) => act({ type: "addSet", exerciseUuid, previousFirst: previousFirstOf(exerciseUuid) }),
    patchSet: (setUuid, values) => act({ type: "patchSet", setUuid, values }),
    completeSet: (setUuid, values) => act({ type: "completeSet", setUuid, values }),
    uncompleteSet: (setUuid) => act({ type: "uncompleteSet", setUuid }),
    deleteSet: (setUuid) => act({ type: "deleteSet", setUuid }),
    restStart: (seconds) => act({ type: "restStart", seconds }),
    restDelta: (seconds) => act({ type: "restDelta", seconds }),
    restSkip: () => act({ type: "restSkip" }),

    finish: (_discardIncomplete, callbacks) => callbacks.onError(NOT_YET_LOCAL),
    cancel: (callbacks) => callbacks.onError(NOT_YET_LOCAL),
  };
}
