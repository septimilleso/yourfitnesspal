// Interfaccia della sessione di allenamento vista dalla UI. Il web la implementa con il
// server (`api/serverSession.ts`), l'IPA con lo store locale (T23). Le operazioni sono
// quelle del reducer di `gymSession.ts`, con esercizi e serie indicati per uuid.
import type { SetValues, Workout } from "../api/gym";
import type { ExerciseRef, LayoutEntry } from "./gymSession";

/** Chiave di esercizio o serie nella UI: l'uuid, o l'id numerico se il dato non lo ha. */
export function keyOf(item: { uuid?: string; id: number }): string {
  return item.uuid ?? String(item.id);
}

/** Esito di un'operazione asincrona: l'errore arriva già come messaggio per l'utente. */
export interface LiveCallbacks<T> {
  onSuccess: (value: T) => void;
  onError: (message: string) => void;
}

export interface LiveSession {
  /** Allenamento da mostrare, nella forma di `GET /workouts/active`. */
  workout: Workout;
  /** Offset dell'orologio del telefono per il timer di riposo; assente, vale `server_now`. */
  clockOffsetMs?: number;
  /** Termina o annulla in corso: disabilita i pulsanti. */
  isFinishing: boolean;
  isCancelling: boolean;

  rename(name: string): void;
  addExercises(exercises: ExerciseRef[]): void;
  replaceExercise(exerciseUuid: string, exercise: ExerciseRef): void;
  removeExercise(exerciseUuid: string): void;
  setNote(exerciseUuid: string, note: string | null): void;
  setRest(exerciseUuid: string, seconds: number): void;
  setLayout(layout: LayoutEntry[]): void;
  addSet(exerciseUuid: string): void;
  patchSet(setUuid: string, values: SetValues): void;
  completeSet(setUuid: string, values: SetValues): void;
  uncompleteSet(setUuid: string): void;
  deleteSet(setUuid: string): void;
  restStart(seconds: number): void;
  restDelta(seconds: number): void;
  restSkip(): void;
  /** `id` è quello del server se la fine è già confermata (sempre sul web; nell'IPA solo se il sync arriva in tempo, R19). */
  finish(discardIncomplete: boolean, callbacks: LiveCallbacks<{ id: number | null; uuid: string }>): void;
  cancel(callbacks: LiveCallbacks<void>): void;
}
