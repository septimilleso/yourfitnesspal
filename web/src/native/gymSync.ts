// Sync dell'allenamento locale verso il server (R15, R16). Qui si invia un `PUT` e si applica l'esito;
// quando inviare (trigger, coalescing, ordine) sta nello scheduler. Importa `api/gym` e lo store, mai il contrario.
import type { QueryClient } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import { type ConflictBody, type Workout, type WorkoutPutBody, gymKeys, putWorkout } from "../api/gym";
import type { SessionWorkout } from "../lib/gymSession";
import { clockOffsetMs } from "../lib/restTimer";
import { type GymConflict, type GymEntry, getSnapshot, patchEntry, removeEntry, setClockOffset } from "./gymStore";

/** Esito di un invio: chi pianifica i tentativi decide cosa fare dopo (R15). */
export type SyncOutcome = "synced" | "pending" | "conflict" | "error" | "unauthorized" | "missing";

function findEntry(uuid: string): GymEntry | undefined {
  const { active, finished } = getSnapshot();
  if (active?.workout.uuid === uuid) return active;
  return finished.find((entry) => entry.workout.uuid === uuid);
}

// Ogni risposta del server porta uuid e version (R1): se mancano la risposta non si applica.
function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`risposta del server senza ${field}`);
  return value;
}

// Il corpo è l'allenamento in ordine, senza id, nome e tracking degli esercizi: il server li ha già.
function bodyOf(entry: GymEntry): WorkoutPutBody {
  const { workout } = entry;
  return {
    base_version: entry.baseVersion,
    name: workout.name,
    template_id: workout.template_id,
    status: workout.status,
    started_at: workout.started_at,
    finished_at: workout.finished_at,
    rest_ends_at: workout.rest_ends_at,
    rest_total_s: workout.rest_total_s,
    exercises: workout.exercises.map((exercise) => ({
      uuid: exercise.uuid,
      exercise_id: exercise.exercise_id,
      rest_seconds: exercise.rest_seconds,
      superset_group: exercise.superset_group,
      note: exercise.note,
      sets: exercise.sets.map((set) => ({
        uuid: set.uuid,
        weight_kg: set.weight_kg,
        reps: set.reps,
        duration_s: set.duration_s,
        completed_at: set.completed_at,
      })),
    })),
  };
}

// Stato di sessione come lo vuole lo store, a partire dalla copia del server.
function sessionFromServer(server: Workout): SessionWorkout {
  return {
    uuid: required(server.uuid, "uuid"),
    id: server.id,
    version: required(server.version, "version"),
    name: server.name,
    template_id: server.template_id,
    status: server.status,
    started_at: server.started_at,
    finished_at: server.finished_at,
    rest_ends_at: server.rest_ends_at,
    rest_total_s: server.rest_total_s,
    exercises: server.exercises.map((exercise) => ({
      uuid: required(exercise.uuid, "uuid"),
      id: exercise.id,
      exercise_id: exercise.exercise.id,
      name: exercise.exercise.name,
      tracking: exercise.exercise.tracking,
      rest_seconds: exercise.rest_seconds,
      superset_group: exercise.superset_group,
      note: exercise.note,
      sets: exercise.sets.map((set) => ({
        uuid: required(set.uuid, "uuid"),
        id: set.id,
        weight_kg: set.weight_kg,
        reps: set.reps,
        duration_s: set.duration_s,
        completed_at: set.completed_at,
      })),
    })),
  };
}

// Modifiche arrivate durante il volo: lo stato locale resta com'è, ma prende gli id del server.
function withServerIds(local: SessionWorkout, server: Workout): SessionWorkout {
  const exerciseIds = new Map<string, number>();
  const setIds = new Map<string, number>();
  for (const exercise of server.exercises) {
    exerciseIds.set(required(exercise.uuid, "uuid"), exercise.id);
    for (const set of exercise.sets) setIds.set(required(set.uuid, "uuid"), set.id);
  }
  return {
    ...local,
    id: server.id,
    exercises: local.exercises.map((exercise) => ({
      ...exercise,
      id: exerciseIds.get(exercise.uuid) ?? exercise.id,
      sets: exercise.sets.map((set) => ({ ...set, id: setIds.get(set.uuid) ?? set.id })),
    })),
  };
}

function conflictOf(error: ApiError): GymConflict {
  const body = error.body as Partial<ConflictBody> | null;
  return { reason: body?.detail ?? error.message, current: body?.current ?? null };
}

function setSync(uuid: string, sync: GymEntry["sync"]): void {
  const entry = findEntry(uuid);
  if (entry !== undefined && entry.sync !== sync) patchEntry(uuid, { sync });
}

// 200 o 201. `sentRevision` è la revisione inviata: se nel frattempo ce ne sono state altre, restano in attesa del prossimo invio.
function applyAccepted(uuid: string, sentRevision: number, server: Workout, queryClient: QueryClient): SyncOutcome {
  const entry = findEntry(uuid);
  if (entry === undefined) return "missing";
  const unchanged = entry.revision === sentRevision;
  setClockOffset(clockOffsetMs(server.server_now, Date.now()));
  if (unchanged && entry.workout.status === "finished") {
    // Finito confermato: lo mette la cache dello Storico e lo tolgono dallo stato locale (R16).
    queryClient.setQueryData(gymKeys.workout(server.id), server);
    void queryClient.invalidateQueries({ queryKey: gymKeys.history });
    void queryClient.invalidateQueries({ queryKey: ["gym", "stats"] });
    void queryClient.invalidateQueries({ queryKey: gymKeys.templates });
    void queryClient.invalidateQueries({ queryKey: gymKeys.offlineSnapshot });
    removeEntry(uuid);
    return "synced";
  }
  // Tutto il calcolo prima della scrittura nello store: un campo mancante non lascia uno stato a metà.
  const baseVersion = required(server.version, "version");
  const workout = unchanged ? sessionFromServer(server) : withServerIds(entry.workout, server);
  patchEntry(uuid, {
    workout,
    baseVersion,
    sentRevision,
    lastServer: server,
    sync: unchanged ? "synced" : "pending",
    conflict: null,
  });
  return unchanged ? "synced" : "pending";
}

// Ogni errore lascia intatti i dati sul telefono. 409 → conflitto (R18), 401 → nessuna modifica (R21),
// altri 4xx → errore di sincronizzazione (R16), 5xx e rete → resta da inviare (R16).
function applyFailure(uuid: string, error: unknown): SyncOutcome {
  if (error instanceof ApiError) {
    if (error.status === 401) return "unauthorized";
    if (error.status === 409) {
      patchEntry(uuid, { sync: "conflict", conflict: conflictOf(error) });
      return "conflict";
    }
    if (error.status < 500) {
      setSync(uuid, "error");
      return "error";
    }
  }
  setSync(uuid, "pending");
  return "pending";
}

/**
 * Invia l'allenamento con `PUT /api/workouts/{uuid}` e applica l'esito. Mai lancia per un errore di
 * rete o del server: lo stato resta coerente e il prossimo trigger riprova.
 */
export async function syncEntry(uuid: string, queryClient: QueryClient): Promise<SyncOutcome> {
  const entry = findEntry(uuid);
  if (entry === undefined) return "missing";
  // Revisione inviata: al ritorno si confronta con la revisione attuale per capire se ci sono modifiche nuove.
  const sentRevision = entry.revision;
  let server: Workout;
  try {
    server = await putWorkout(uuid, bodyOf(entry));
  } catch (error) {
    return applyFailure(uuid, error);
  }
  return applyAccepted(uuid, sentRevision, server, queryClient);
}
