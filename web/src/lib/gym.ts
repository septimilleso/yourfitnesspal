import { ApiError } from "../api/client";
import type { Exercise, SetValues, Tracking } from "../api/gym";

export const EQUIPMENT_LABELS: Record<string, string> = {
  bands: "Elastici",
  barbell: "Bilanciere",
  "body only": "Corpo libero",
  cable: "Cavi",
  dumbbell: "Manubri",
  "e-z curl bar": "Bilanciere EZ",
  "exercise ball": "Fitball",
  "foam roll": "Foam roller",
  kettlebells: "Kettlebell",
  machine: "Macchina",
  "medicine ball": "Palla medica",
  other: "Altro",
};

export const MUSCLE_LABELS: Record<string, string> = {
  abdominals: "Addominali",
  abductors: "Abduttori",
  adductors: "Adduttori",
  biceps: "Bicipiti",
  calves: "Polpacci",
  chest: "Petto",
  forearms: "Avambracci",
  glutes: "Glutei",
  hamstrings: "Femorali",
  lats: "Dorsali",
  "lower back": "Lombari",
  "middle back": "Dorso centrale",
  neck: "Collo",
  quadriceps: "Quadricipiti",
  shoulders: "Spalle",
  traps: "Trapezi",
  triceps: "Tricipiti",
};

export const TRACKING_LABELS: Record<Tracking, string> = {
  weight_reps: "Peso × ripetizioni",
  reps: "Solo ripetizioni",
  duration: "Durata",
};

export function equipmentLabel(value: string | null): string | null {
  return value ? (EQUIPMENT_LABELS[value] ?? value) : null;
}

export function muscleLabel(value: string): string {
  return MUSCLE_LABELS[value] ?? value;
}

export function exerciseSubtitle(exercise: Exercise): string {
  const parts = [equipmentLabel(exercise.equipment)];
  if (exercise.primary_muscles[0]) parts.push(muscleLabel(exercise.primary_muscles[0]));
  return parts.filter(Boolean).join(" · ");
}

export type SetField = keyof SetValues;

export const FIELD_META: Record<SetField, { label: string; kind: "decimal" | "integer" | "duration" }> = {
  weight_kg: { label: "kg", kind: "decimal" },
  reps: { label: "Rip.", kind: "integer" },
  duration_s: { label: "Tempo", kind: "duration" },
};

/** The inputs a set of this exercise shows, left to right. */
export function setFields(tracking: Tracking): SetField[] {
  if (tracking === "weight_reps") return ["weight_kg", "reps"];
  if (tracking === "reps") return ["reps"];
  return ["duration_s"];
}

/** CSS grid columns of a set row: number | previous | inputs... | tick. */
export function setGridColumns(fieldCount: number): string {
  return `2.25rem minmax(0,1.3fr) repeat(${fieldCount}, minmax(0,1fr)) 2.75rem`;
}

export function formatKg(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function parseInteger(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "m:ss", or a plain number of seconds. */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  const match = /^(\d+):([0-5]\d)$/.exec(trimmed);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** Same text as the API's `format_set` ("80 kg × 8", "12 rip", "1:15"). */
export function formatSet(tracking: Tracking, values: SetValues): string {
  if (tracking === "duration") return formatDuration(values.duration_s ?? 0);
  if (tracking === "reps" && values.weight_kg === null) return `${values.reps ?? 0} rip`;
  return `${formatKg(values.weight_kg ?? 0)} kg × ${values.reps ?? 0}`;
}

/** Rest choices: 0:00 to 10:00 in 15 s steps. */
export const REST_OPTIONS: number[] = Array.from({ length: 41 }, (_, i) => i * 15);

export function restLabel(seconds: number): string {
  return seconds === 0 ? "Off" : formatDuration(seconds);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function elapsedLabel(startIso: string, nowMs: number): string {
  const total = Math.max(0, Math.floor((nowMs - Date.parse(startIso)) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function durationLabel(startIso: string, endIso: string): string {
  const minutes = Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function lastUsedLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "Oggi";
  if (days === 1) return "Ieri";
  if (days < 7) return `${days} giorni fa`;
  return then.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

export function workoutDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

/** Mirror of the API's `normalize_supersets`: runs of equal values become
 * groups 1..n, a lone member becomes null. */
export function normalizeSupersets(groups: (number | null)[]): (number | null)[] {
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

export function linkWithNext(groups: (number | null)[], index: number): (number | null)[] {
  if (index + 1 >= groups.length) return normalizeSupersets(groups);
  const result = [...groups];
  const used = result.filter((g): g is number => g !== null);
  const group = result[index] ?? result[index + 1] ?? (used.length ? Math.max(...used) + 1 : 1);
  const nextGroup = result[index + 1];
  if (nextGroup !== null && nextGroup !== group) {
    for (let i = index + 1; i < result.length && result[i] === nextGroup; i += 1) result[i] = group;
  } else {
    result[index + 1] = group;
  }
  result[index] = group;
  return normalizeSupersets(result);
}

export function unlinkFromGroup(groups: (number | null)[], index: number): (number | null)[] {
  const result = [...groups];
  result[index] = null;
  return normalizeSupersets(result);
}

export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const result = [...items];
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}

const LIVE_ERRORS: Record<string, string> = {
  "weight and reps are required": "Inserisci kg e ripetizioni",
  "reps are required": "Inserisci le ripetizioni",
  "duration is required": "Inserisci la durata",
  "no rest timer running": "Nessun timer attivo",
  "workout is not in progress": "L'allenamento è già terminato",
  empty_workout: "Nessuna serie completata",
  incomplete_sets: "Ci sono serie non completate",
};

/** Testo per l'utente di un messaggio di errore della sessione (server o reducer locale). */
export function liveErrorText(message: string): string {
  return LIVE_ERRORS[message] ?? message;
}

export function liveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) return "Valori non validi";
    return liveErrorText(error.message);
  }
  return "Non salvato: controlla la connessione";
}
