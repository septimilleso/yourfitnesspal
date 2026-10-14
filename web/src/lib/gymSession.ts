// Reducer puro della sessione di allenamento: serie, riposo, esercizi, layout, fine,
// Precedente e Max. Stesse regole e stessi messaggi del server (`set_problem`,
// `rest_after_completion`, `rest_action`, `add_exercise`, `patch_exercise`, `set_layout`,
// `finish_workout`, `start_workout`), portati in `gymRules.ts`. Nessun orologio né
// generatore di UUID interni: arrivano da `deps`.
import type { Exercise, OfflineSnapshot, SetValues, SnapshotExercise, Template, Tracking, Workout } from "../api/gym";
import {
  type ExerciseProgress,
  NoRestTimerError,
  type WorkoutStatus,
  exercisePrefill,
  finishProblem,
  finishPrune,
  isoOffset,
  nextSetValues,
  normalizeSupersets,
  restAction,
  restAfterCompletion,
  roundKg,
  setProblem,
  trackingReset,
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

/** Ciò che il selettore esercizi passa: solo i campi che servono a creare la riga. */
export type ExerciseRef = Pick<Exercise, "id" | "name" | "tracking">;

/** Una voce del layout: esercizio (per uuid) con il gruppo di superserie richiesto. */
export interface LayoutEntry {
  exerciseUuid: string;
  superset_group: number | null;
}

export type SessionAction =
  | { type: "patchSet"; setUuid: string; values: SetValues }
  | { type: "completeSet"; setUuid: string; values: SetValues }
  | { type: "uncompleteSet"; setUuid: string }
  | { type: "addSet"; exerciseUuid: string; previousFirst: SetValues | null }
  | { type: "deleteSet"; setUuid: string }
  | { type: "restStart"; seconds: number }
  | { type: "restDelta"; seconds: number }
  | { type: "restSkip" }
  | { type: "addExercises"; exercises: ExerciseRef[]; snapshot: OfflineSnapshot | null }
  | { type: "replaceExercise"; exerciseUuid: string; exercise: ExerciseRef }
  | { type: "setRest"; exerciseUuid: string; seconds: number }
  | { type: "setNote"; exerciseUuid: string; note: string | null }
  | { type: "setLayout"; layout: LayoutEntry[] }
  | { type: "removeExercise"; exerciseUuid: string }
  | { type: "rename"; name: string }
  | { type: "finish"; discardIncomplete: boolean };

export interface SessionDeps {
  /** Ms epoch sull'orologio del server stimato. */
  now: number;
  /** Generatore di UUID v4 per allenamenti, esercizi e serie nuovi. */
  uuid: () => string;
}

export type SessionResult =
  | { ok: true; state: SessionWorkout }
  /** `error` è il messaggio del server; `state` è lo stato di prima, lo stesso riferimento. */
  | { ok: false; error: string; state: SessionWorkout };

/** Avvio di un allenamento: non c'è ancora uno stato da restituire in caso d'errore. */
export type StartResult = { ok: true; state: SessionWorkout } | { ok: false; error: string };

/**
 * Fuso del nome "Allenamento GG/MM/AAAA": quello di `settings.app_timezone` del server
 * (default "Europe/Rome"), così il nome offline è lo stesso che darebbe `start_workout`.
 * Il client non riceve il fuso dal server: lo si passa a `startEmpty` se serve un altro.
 */
export const APP_TIME_ZONE = "Europe/Rome";

// Stesso testo del server (`Invalid` → 400) o del 422 che `liveErrorMessage` traduce in "Valori non validi".
const VALUES_INVALID = "Valori non validi";
const LAYOUT_INVALID = "layout must list every exercise once";

// Tetti dello schema del `PUT /api/workouts/{uuid}`: superarli farebbe rifiutare la sync per sempre.
const MAX_EXERCISES = 100;
const MAX_SETS = 100;
const MAX_NAME = 100;
const MAX_NOTE = 500;
const MAX_REST_SECONDS = 600;

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
// Si controlla il valore inviato, prima di roundKg: lo schema del server lo fa sul grezzo.
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

/** Lunghezza in caratteri come `max_length` di pydantic (code point, non unità UTF-16). */
function codePoints(text: string): number {
  return [...text].length;
}

/**
 * Strip come `str.strip()` di Python, che lo schema del server applica al nome. `String.trim`
 * non basta: non toglie U+0085 né U+001C–U+001F, e il server li toglie, quindi il PUT non va
 * rifiutato per un nome che qui sembra valido.
 */
function stripText(text: string): string {
  return text.replace(/^[\s\u001c-\u001f\u0085]+|[\s\u001c-\u001f\u0085]+$/gu, "");
}

/** Limiti di `SetValues`, `RestIn`, `RestSeconds`, nome e nota, controllati prima di ogni altra regola (come lo schema). */
function checkInput(action: SessionAction): void {
  if (action.type === "patchSet" || action.type === "completeSet") {
    if (valuesOutOfRange(action.values)) throw new SessionError(VALUES_INVALID);
  } else if (action.type === "restStart") {
    if (!isIntegerIn(action.seconds, 1, 600)) throw new SessionError(VALUES_INVALID);
  } else if (action.type === "restDelta") {
    if (!isIntegerIn(action.seconds, -600, 600)) throw new SessionError(VALUES_INVALID);
  } else if (action.type === "setRest") {
    if (!isIntegerIn(action.seconds, 0, MAX_REST_SECONDS)) throw new SessionError(VALUES_INVALID);
  } else if (action.type === "setNote") {
    // `note` vuota diventa null, come `payload.note or None` sul server.
    if (action.note !== null && codePoints(action.note) > MAX_NOTE) throw new SessionError(VALUES_INVALID);
  } else if (action.type === "rename") {
    // Il nome viene ripulito dagli spazi prima del controllo di lunghezza (`strip_whitespace`).
    const name = codePoints(stripText(action.name));
    if (name < 1 || name > MAX_NAME) throw new SessionError(VALUES_INVALID);
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

/** Superserie rinumerate 1..n come `_renumber` sul server (gruppi uguali adiacenti). */
function renumberSupersets(exercises: SessionExercise[]): SessionExercise[] {
  const groups = normalizeSupersets(exercises.map((exercise) => exercise.superset_group));
  return exercises.map((exercise, i) => ({ ...exercise, superset_group: groups[i] }));
}

/** Serie appena creata: uuid nuovo, non fatta, valori puliti come sul server. */
function newSet(uuid: string, values: SetValues): SessionSet {
  return { uuid, id: null, ...cleanValues(values), completed_at: null };
}

/**
 * Esercizio nuovo con le sue serie. Ordine degli uuid: prima l'esercizio, poi le serie.
 * Più di 100 serie non sono salvabili con il `PUT`, quindi si rifiuta qui.
 */
function newExercise(
  ref: ExerciseRef,
  uuid: () => string,
  options: { rest_seconds: number; superset_group: number | null; note: string | null; sets: SetValues[] },
): SessionExercise {
  if (options.sets.length > MAX_SETS) throw new SessionError(VALUES_INVALID);
  const exerciseUuid = uuid();
  return {
    uuid: exerciseUuid,
    id: null,
    exercise_id: ref.id,
    name: ref.name,
    tracking: ref.tracking,
    rest_seconds: options.rest_seconds,
    superset_group: options.superset_group,
    note: options.note,
    sets: options.sets.map((values) => newSet(uuid(), values)),
  };
}

/** Dopo un cambio di tracking: le serie perdono il completamento e i campi non usati. */
function resetTracking(tracking: Tracking, sets: SessionSet[]): SessionSet[] {
  const states = trackingReset(
    tracking,
    sets.map((set) => ({
      weight_kg: set.weight_kg,
      reps: set.reps,
      duration_s: set.duration_s,
      completed: set.completed_at !== null,
    })),
  );
  return sets.map((set, i) => ({
    ...set,
    weight_kg: states[i].weight_kg,
    reps: states[i].reps,
    duration_s: states[i].duration_s,
    completed_at: null,
  }));
}

/** Voce dello snapshot per un esercizio, o null se non c'è (fuori dallo snapshot). */
function snapshotOf(snapshot: OfflineSnapshot | null, exerciseId: number): SnapshotExercise | null {
  return snapshot?.exercises.find((item) => item.exercise.id === exerciseId) ?? null;
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
      if (sets.length >= MAX_SETS) throw new SessionError(VALUES_INVALID);
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

    case "addExercises": {
      // Come `add_exercise`: riposo e serie da Precedente (snapshot), altrimenti una serie vuota e 90 s.
      if (state.exercises.length + action.exercises.length > MAX_EXERCISES) throw new SessionError(VALUES_INVALID);
      const added = action.exercises.map((ref) => {
        const entry = snapshotOf(action.snapshot, ref.id);
        const prefill = exercisePrefill(entry?.rest_seconds ?? null, entry?.previous ?? []);
        return newExercise(ref, uuid, {
          rest_seconds: prefill.rest_seconds,
          superset_group: null,
          note: null,
          sets: prefill.sets,
        });
      });
      return { ...state, exercises: [...state.exercises, ...added] };
    }

    case "replaceExercise": {
      const e = locateExercise(state, action.exerciseUuid);
      const exercise = state.exercises[e];
      // Stesso esercizio: `patch_exercise` non cambia nulla.
      if (action.exercise.id === exercise.exercise_id) return state;
      // Le serie cambiano solo con un tracking diverso, come `patch_exercise`.
      const sets =
        action.exercise.tracking === exercise.tracking
          ? exercise.sets
          : resetTracking(action.exercise.tracking, exercise.sets);
      return {
        ...state,
        exercises: replaceAt(state.exercises, e, {
          ...exercise,
          exercise_id: action.exercise.id,
          name: action.exercise.name,
          tracking: action.exercise.tracking,
          sets,
        }),
      };
    }

    case "setRest": {
      const e = locateExercise(state, action.exerciseUuid);
      return { ...state, exercises: replaceAt(state.exercises, e, { ...state.exercises[e], rest_seconds: action.seconds }) };
    }

    case "setNote": {
      const e = locateExercise(state, action.exerciseUuid);
      return { ...state, exercises: replaceAt(state.exercises, e, { ...state.exercises[e], note: action.note || null }) };
    }

    case "setLayout": {
      // Come `set_layout`: ogni esercizio una sola volta, poi ordine e superserie rinumerate.
      const byUuid = new Map(state.exercises.map((exercise) => [exercise.uuid, exercise]));
      const uuids = action.layout.map((entry) => entry.exerciseUuid);
      const complete =
        uuids.length === state.exercises.length &&
        new Set(uuids).size === uuids.length &&
        uuids.every((exerciseUuid) => byUuid.has(exerciseUuid));
      if (!complete) throw new SessionError(LAYOUT_INVALID);
      const ordered = action.layout.map((entry) => ({
        ...byUuid.get(entry.exerciseUuid)!,
        superset_group: entry.superset_group,
      }));
      return { ...state, exercises: renumberSupersets(ordered) };
    }

    case "removeExercise": {
      const e = locateExercise(state, action.exerciseUuid);
      return { ...state, exercises: renumberSupersets(state.exercises.filter((_, index) => index !== e)) };
    }

    case "rename":
      return { ...state, name: stripText(action.name) };

    case "finish": {
      // Come `finish_workout`: regole di fine, poi si tengono solo le serie fatte e gli esercizi con almeno una.
      const done = state.exercises.map((exercise) => exercise.sets.map((set) => set.completed_at !== null));
      const problem = finishProblem(done.flat(), action.discardIncomplete);
      if (problem) throw new SessionError(problem);
      const kept = new Map(finishPrune(done));
      const exercises = state.exercises.flatMap((exercise, index) => {
        const keep = kept.get(index);
        return keep === undefined ? [] : [{ ...exercise, sets: keep.map((n) => exercise.sets[n]) }];
      });
      return {
        ...state,
        status: "finished",
        finished_at: isoOffset(now),
        rest_ends_at: null,
        rest_total_s: null,
        exercises: renumberSupersets(exercises),
      };
    }
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

/** GG/MM/AAAA del giorno di `ms` nel fuso indicato. `formatToParts` non dipende dall'ordine dei campi del locale. */
function localDay(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")}`;
}

/** Allenamento vuoto "Allenamento GG/MM/AAAA", come `start_workout` senza modello. */
export function startEmpty(deps: SessionDeps, timeZone: string = APP_TIME_ZONE): SessionWorkout {
  return {
    uuid: deps.uuid(),
    id: null,
    version: null,
    name: `Allenamento ${localDay(deps.now, timeZone)}`,
    template_id: null,
    status: "in_progress",
    started_at: isoOffset(deps.now),
    finished_at: null,
    rest_ends_at: null,
    rest_total_s: null,
    exercises: [],
  };
}

/**
 * Allenamento da un modello, come `start_workout` con `template_id`: nome del modello, esercizi,
 * serie (valori, non fatte), riposo, superserie e note copiati nell'ordine. Non rinumera le superserie.
 */
export function startFromTemplate(template: Template, deps: SessionDeps): StartResult {
  if (template.exercises.length > MAX_EXERCISES || template.exercises.some((item) => item.sets.length > MAX_SETS)) {
    return { ok: false, error: VALUES_INVALID };
  }
  const workoutUuid = deps.uuid();
  const exercises = template.exercises.map((item) =>
    newExercise(item.exercise, deps.uuid, {
      rest_seconds: item.rest_seconds,
      superset_group: item.superset_group,
      note: item.note,
      sets: item.sets,
    }),
  );
  return {
    ok: true,
    state: {
      uuid: workoutUuid,
      id: null,
      version: null,
      name: template.name,
      template_id: template.id,
      status: "in_progress",
      started_at: isoOffset(deps.now),
      finished_at: null,
      rest_ends_at: null,
      rest_total_s: null,
      exercises,
    },
  };
}

/** Precedente e Max di una serie. `null` = nessun valore: si mostra "—" e nessun max. */
export interface PreviousAndMax {
  previous: SetValues | null;
  max: SetValues | null;
}

/**
 * Precedente della prima serie di un esercizio, da passare ad `addSet` quando l'esercizio non ha
 * serie. Null se l'esercizio è fuori dallo snapshot o non ha Precedente.
 */
export function previousFirst(exerciseId: number, snapshot: OfflineSnapshot | null): SetValues | null {
  return snapshotOf(snapshot, exerciseId)?.previous[0] ?? null;
}

/**
 * R13: Precedente e Max per ogni serie, per uuid. Se l'ultima risposta del server contiene la serie
 * (stesso uuid) E la serie è ancora nello stesso esercizio e alla stessa posizione, valgono i suoi
 * `previous` e `max_set` (come `workout_out` sul server). Altrimenti le liste dello snapshot per
 * posizione. Un esercizio fuori dallo snapshot non ha nulla.
 */
export function previousAndMax(
  entry: { workout: SessionWorkout; lastServer: Workout | null },
  snapshot: OfflineSnapshot | null,
): Map<string, PreviousAndMax> {
  // Per uuid di serie: esercizio e posizione in cui il server l'ha vista, con i suoi valori.
  const served = new Map<string, { exerciseId: number; index: number; hint: PreviousAndMax }>();
  for (const exercise of entry.lastServer?.exercises ?? []) {
    exercise.sets.forEach((set, index) => {
      if (set.uuid !== undefined) {
        served.set(set.uuid, {
          exerciseId: exercise.exercise.id,
          index,
          hint: { previous: set.previous ?? null, max: set.max_set ?? null },
        });
      }
    });
  }
  const result = new Map<string, PreviousAndMax>();
  for (const exercise of entry.workout.exercises) {
    const fromSnapshot = snapshotOf(snapshot, exercise.exercise_id);
    exercise.sets.forEach((set, index) => {
      const hit = served.get(set.uuid);
      const sameSpot = hit !== undefined && hit.exerciseId === exercise.exercise_id && hit.index === index;
      result.set(
        set.uuid,
        hit !== undefined && sameSpot
          ? hit.hint
          : { previous: fromSnapshot?.previous[index] ?? null, max: fromSnapshot?.max[index] ?? null },
      );
    });
  }
  return result;
}
