// Porting puro di api/app/services/gym_rules.py. Nessun orologio globale: `now` è
// ms epoch; gli orari di un allenamento sono stringhe ISO con offset, come sul filo
// e nella fixture; le uscite le scrivono con `isoOffset` (`+00:00`, come isoformat).
import type { SetValues, Tracking } from "../api/gym";

export const DEFAULT_REST_SECONDS = 90;
// R6: orari del client fino a 5 minuti avanti all'orologio del server; riposo ≤ 600 s.
const TIME_TOLERANCE_MS = 5 * 60_000;
const MAX_REST_SECONDS = 600;

export type WorkoutStatus = "in_progress" | "finished";

const TRACKING_FIELDS: Record<Tracking, readonly (keyof SetValues)[]> = {
  weight_reps: ["weight_kg", "reps"],
  reps: ["reps"],
  duration: ["duration_s"],
};

const EMPTY_SET: SetValues = { weight_kg: null, reps: null, duration_s: null };

export class NoRestTimerError extends Error {
  constructor() {
    super("no rest timer running");
    this.name = "NoRestTimerError";
  }
}

/** Come `datetime.isoformat()` di un datetime UTC: `+00:00`, microsecondi solo se presenti. */
export function isoOffset(ms: number): string {
  const iso = new Date(ms).toISOString();
  const millis = iso.slice(20, 23);
  return `${iso.slice(0, 19)}${millis === "000" ? "" : `.${millis}000`}+00:00`;
}

// Half-up sul decimale più corto del float (come Decimal(str(v))): 80.125 -> 80.13.
function roundTwo(value: number): number {
  const sign = Math.sign(value);
  const scaled = Number(`${Math.abs(value)}e2`);
  if (!Number.isFinite(scaled)) return Math.round(value * 100) / 100;
  return sign * Number(`${Math.round(scaled)}e-2`);
}

/** Peso a 2 decimali, come `_two_decimals` del server (schema del PUT). */
export function roundKg(value: number | null): number | null {
  return value === null ? null : roundTwo(value);
}

/** Renumera i gruppi di superserie 1..n su tratti di valori uguali; un solo membro è null. */
export function normalizeSupersets(groups: readonly (number | null)[]): (number | null)[] {
  const result: (number | null)[] = groups.map(() => null);
  let next = 1;
  let start = 0;
  while (start < groups.length) {
    let end = start;
    if (groups[start] !== null) {
      while (end + 1 < groups.length && groups[end + 1] === groups[start]) end += 1;
    }
    if (end > start) {
      for (let i = start; i <= end; i += 1) result[i] = next;
      next += 1;
    }
    start = end + 1;
  }
  return result;
}

export type SetProblem = "weight and reps are required" | "reps are required" | "duration is required";

/** Perché una serie non può essere segnata fatta, o null. */
export function setProblem(
  tracking: Tracking,
  weightKg: number | null,
  reps: number | null,
  durationS: number | null,
): SetProblem | null {
  if (tracking === "weight_reps" && (weightKg === null || reps === null)) {
    return "weight and reps are required";
  }
  if (tracking === "reps" && reps === null) return "reps are required";
  if (tracking === "duration" && durationS === null) return "duration is required";
  return null;
}

export interface ExerciseProgress {
  rest_seconds: number;
  superset_group: number | null;
  set_positions: readonly number[];
  completed_positions: readonly number[];
}

/** Secondi di riposo da avviare dopo la serie `position` di `exercises[index]`; null = nessun timer. */
export function restAfterCompletion(
  exercises: readonly ExerciseProgress[],
  index: number,
  position: number,
): number | null {
  const current = exercises[index];
  let rest: number;
  if (current.superset_group === null) {
    rest = current.rest_seconds;
  } else {
    const group = exercises.filter((e) => e.superset_group === current.superset_group);
    const roundDone = group.every(
      (e) => !e.set_positions.includes(position) || e.completed_positions.includes(position),
    );
    if (!roundDone) return null;
    rest = group[group.length - 1].rest_seconds;
  }
  return rest || null;
}

export function formatDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Peso in kg con virgola e senza zeri finali: "37,5", "80". */
function formatKg(value: number): string {
  return roundTwo(value).toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

/** Stesso testo di `format_set` del server e di `formatSet` in gym.ts. */
export function formatSetText(tracking: Tracking, values: SetValues): string {
  if (tracking === "duration") return formatDuration(values.duration_s ?? 0);
  if (tracking === "reps" && values.weight_kg === null) return `${values.reps ?? 0} rip`;
  return `${formatKg(values.weight_kg ?? 0)} kg × ${values.reps ?? 0}`;
}

export interface DiffExercise {
  exercise_id: number;
  name: string;
  tracking: Tracking;
  rest_seconds: number;
  superset_group: number | null;
  sets: SetValues[];
}

function sameSetValues(a: SetValues, b: SetValues): boolean {
  return a.weight_kg === b.weight_kg && a.reps === b.reps && a.duration_s === b.duration_s;
}

function keyed(items: readonly DiffExercise[]): [string, DiffExercise][] {
  const seen = new Map<number, number>();
  return items.map((item) => {
    const occurrence = seen.get(item.exercise_id) ?? 0;
    seen.set(item.exercise_id, occurrence + 1);
    return [`${item.exercise_id}:${occurrence}`, item];
  });
}

function partners(items: [string, DiffExercise][]): Map<string, Set<string>> {
  const groups = new Map<number, Set<string>>();
  for (const [key, item] of items) {
    if (item.superset_group === null) continue;
    const members = groups.get(item.superset_group) ?? new Set<string>();
    members.add(key);
    groups.set(item.superset_group, members);
  }
  const result = new Map<string, Set<string>>();
  for (const [key, item] of items) {
    result.set(key, item.superset_group === null ? new Set() : (groups.get(item.superset_group) ?? new Set()));
  }
  return result;
}

function exerciseChanges(old: DiffExercise, next: DiffExercise): string[] {
  const changes: string[] = [];
  const shared = Math.min(old.sets.length, next.sets.length);
  for (let i = 0; i < shared; i += 1) {
    const a = old.sets[i];
    const b = next.sets[i];
    if (!sameSetValues(a, b)) {
      changes.push(
        `${next.name}: serie ${i + 1} ${formatSetText(next.tracking, a)} → ${formatSetText(next.tracking, b)}`,
      );
    }
  }
  const extra = next.sets.length - old.sets.length;
  if (extra > 0) changes.push(`${next.name}: +${extra} serie`);
  else if (extra < 0) changes.push(`${next.name}: ${extra} serie`);
  if (old.rest_seconds !== next.rest_seconds) {
    changes.push(
      `${next.name}: riposo ${formatDuration(old.rest_seconds)} → ${formatDuration(next.rest_seconds)}`,
    );
  }
  return changes;
}

/** Differenze leggibili tra modello e allenamento; lista vuota = nulla da chiedere. */
export function templateDiff(template: readonly DiffExercise[], workout: readonly DiffExercise[]): string[] {
  const before = keyed(template);
  const after = keyed(workout);
  const beforeMap = new Map(before);
  const afterMap = new Map(after);
  const changes: string[] = [];
  for (const [key, item] of after) {
    const old = beforeMap.get(key);
    if (old === undefined) changes.push(`Aggiunto: ${item.name}`);
    else changes.push(...exerciseChanges(old, item));
  }
  for (const [key, item] of before) {
    if (!afterMap.has(key)) changes.push(`Rimosso: ${item.name}`);
  }

  const common = new Set([...beforeMap.keys()].filter((key) => afterMap.has(key)));
  const orderBefore = before.map(([key]) => key).filter((key) => common.has(key));
  const orderAfter = after.map(([key]) => key).filter((key) => common.has(key));
  const partnersBefore = partners(before);
  const partnersAfter = partners(after);
  const groupsChanged = [...common].some((key) => {
    const b = [...partnersBefore.get(key)!].filter((k) => common.has(k)).sort();
    const a = [...partnersAfter.get(key)!].filter((k) => common.has(k)).sort();
    return b.join("|") !== a.join("|");
  });
  const orderChanged = orderBefore.join("|") !== orderAfter.join("|");
  if (orderChanged || groupsChanged) changes.push("Ordine o superserie modificati");
  return changes;
}

export interface SetState extends SetValues {
  completed: boolean;
}

export function nextSetValues(last: SetValues | null, previousFirst: SetValues | null): SetValues {
  if (last !== null) return last;
  if (previousFirst !== null) return previousFirst;
  return { ...EMPTY_SET };
}

/** Riposo e serie di un esercizio aggiunto, dalla sua ultima apparizione finita. */
export function exercisePrefill(
  previousRest: number | null,
  previousSets: readonly SetValues[],
): { rest_seconds: number; sets: SetValues[] } {
  const rest_seconds = previousRest ?? DEFAULT_REST_SECONDS;
  const sets = previousSets.length ? previousSets.map((s) => ({ ...s })) : [{ ...EMPTY_SET }];
  return { rest_seconds, sets };
}

/** Dopo un cambio di tracking: nessuna serie è più fatta e i campi non usati si azzerano. */
export function trackingReset(tracking: Tracking, sets: readonly SetState[]): SetState[] {
  const used = TRACKING_FIELDS[tracking];
  return sets.map((s) => ({
    weight_kg: used.includes("weight_kg") ? s.weight_kg : null,
    reps: used.includes("reps") ? s.reps : null,
    duration_s: used.includes("duration_s") ? s.duration_s : null,
    completed: false,
  }));
}

export interface RestActionOptions {
  startS?: number | null;
  deltaS?: number | null;
  skip?: boolean;
}

/** Nuovi (ends_at, total_s) dopo un'azione sul riposo. Lancia NoRestTimerError se serve un timer e non c'è. */
export function restAction(
  now: number,
  endsAt: string | null,
  totalS: number | null,
  options: RestActionOptions,
): { ends_at: string | null; total_s: number | null } {
  if (options.skip) return { ends_at: null, total_s: null };
  if (options.startS != null) {
    return { ends_at: isoOffset(now + options.startS * 1000), total_s: options.startS };
  }
  if (endsAt === null || Date.parse(endsAt) <= now) throw new NoRestTimerError();
  const delta = options.deltaS ?? 0;
  const ends = Date.parse(endsAt) + delta * 1000;
  if (ends <= now) return { ends_at: null, total_s: null };
  return { ends_at: isoOffset(ends), total_s: Math.max(1, (totalS ?? 0) + delta) };
}

/** Perché l'allenamento non si può finire, o null. Le serie non fatte richiedono conferma. */
export function finishProblem(completed: readonly boolean[], discardIncomplete: boolean): "empty_workout" | "incomplete_sets" | null {
  if (!completed.some(Boolean)) return "empty_workout";
  if (!completed.every(Boolean) && !discardIncomplete) return "incomplete_sets";
  return null;
}

/** Cosa sopravvive a una fine: per ogni esercizio con almeno una serie fatta, indice e serie fatte. */
export function finishPrune(completed: readonly (readonly boolean[])[]): [number, number[]][] {
  const kept: [number, number[]][] = [];
  completed.forEach((sets, index) => {
    if (sets.some(Boolean)) kept.push([index, sets.flatMap((done, n) => (done ? [n] : []))]);
  });
  return kept;
}

export interface StateSet {
  weight_kg: number | null;
  reps: number | null;
  duration_s: number | null;
  completed_at: string | null;
}

export interface StateExercise {
  exercise_id: number;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: StateSet[];
}

/** Un allenamento come lo invia `PUT /api/workouts/{uuid}`, senza uuid né versione. */
export interface StateWorkout {
  name: string;
  template_id: number | null;
  status: WorkoutStatus;
  started_at: string;
  finished_at: string | null;
  rest_ends_at: string | null;
  rest_total_s: number | null;
  exercises: StateExercise[];
}

function canonicalSet(set: StateSet): StateSet {
  return { ...set, weight_kg: roundKg(set.weight_kg) };
}

/** Come lo salva il server: finito = solo serie fatte, senza esercizi vuoti e senza riposo; superserie rinumerate. */
export function canonicalWorkout(state: StateWorkout): StateWorkout {
  const finished = state.status === "finished";
  const kept: StateExercise[] = [];
  for (const exercise of state.exercises) {
    const sets = exercise.sets
      .filter((s) => !finished || s.completed_at !== null)
      .map(canonicalSet);
    if (finished && sets.length === 0) continue;
    kept.push({ ...exercise, sets });
  }
  const groups = normalizeSupersets(kept.map((e) => e.superset_group));
  return {
    ...state,
    rest_ends_at: finished ? null : state.rest_ends_at,
    rest_total_s: finished ? null : state.rest_total_s,
    exercises: kept.map((exercise, i) => ({ ...exercise, superset_group: groups[i] })),
  };
}

/** Di contenuto uguale dopo la forma canonica; gli orari si confrontano come istanti. */
export function sameContent(a: StateWorkout, b: StateWorkout): boolean {
  return contentKey(canonicalWorkout(a)) === contentKey(canonicalWorkout(b));
}

function instant(value: string | null): string | null {
  return value === null ? null : isoOffset(Date.parse(value));
}

function contentKey(state: StateWorkout): string {
  return JSON.stringify({
    name: state.name,
    template_id: state.template_id,
    status: state.status,
    started_at: instant(state.started_at),
    finished_at: instant(state.finished_at),
    rest_ends_at: instant(state.rest_ends_at),
    rest_total_s: state.rest_total_s,
    exercises: state.exercises.map((e) => ({
      exercise_id: e.exercise_id,
      rest_seconds: e.rest_seconds,
      superset_group: e.superset_group,
      note: e.note,
      sets: e.sets.map((s) => ({
        weight_kg: s.weight_kg,
        reps: s.reps,
        duration_s: s.duration_s,
        completed_at: instant(s.completed_at),
      })),
    })),
  });
}

function clampMs(value: number, low: number, high: number): number {
  return Math.max(Math.min(value, high), low);
}

/** Orari riportati nell'intervallo plausibile attorno a `now` (R6): si limitano, non si rifiutano. */
export function clampTimes(state: StateWorkout, now: number): StateWorkout {
  const ceiling = now + TIME_TOLERANCE_MS;
  const startedMs = Math.min(Date.parse(state.started_at), ceiling);
  const finished = state.status === "finished";
  const finishedMs =
    state.finished_at === null ? null : clampMs(Date.parse(state.finished_at), startedMs, ceiling);
  const lastMs = finished && finishedMs !== null ? finishedMs : ceiling;
  const exercises = state.exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((s) => ({
      ...s,
      completed_at:
        s.completed_at === null ? null : isoOffset(clampMs(Date.parse(s.completed_at), startedMs, lastMs)),
    })),
  }));
  const hasRest = state.rest_ends_at !== null && state.rest_total_s !== null;
  return {
    ...state,
    started_at: isoOffset(startedMs),
    finished_at: finishedMs === null ? null : isoOffset(finishedMs),
    rest_ends_at: hasRest
      ? isoOffset(Math.min(Date.parse(state.rest_ends_at!), now + MAX_REST_SECONDS * 1000 + TIME_TOLERANCE_MS))
      : null,
    rest_total_s: hasRest ? clampMs(state.rest_total_s!, 1, MAX_REST_SECONDS) : null,
    exercises,
  };
}
