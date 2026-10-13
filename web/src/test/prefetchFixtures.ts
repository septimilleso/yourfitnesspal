// Fixture e fetch instradato per i test del precarico. Solo test: nessun codice di produzione le importa.
import { type Mock, vi } from "vitest";

import type { Me } from "../api/auth";
import type {
  Exercise,
  ExerciseList,
  ExerciseProgress,
  GymCount,
  GymStats,
  HistoryPage,
  PerformedExercise,
  Template,
  TemplatesResponse,
  Workout,
} from "../api/gym";
import type { DayResponse, Goal, WeekResponse } from "../api/queries";
import type { SavedWeekDetail, SavedWeekSummary } from "../api/savedWeeks";
import type { WeightHistory } from "../api/weights";
import type { Permission } from "../lib/permissions";

const NUTRIMENTS = { kcal: 0, protein_g: 0, carbs_g: 0, sugars_g: 0, fat_g: 0, sat_fat_g: 0, fiber_g: 0, salt_g: 0 };
const WORKOUT_COUNT = 25;
const FIRST_PAGE_SIZE = 20;
const TEMPLATE_COUNT = 3;
const SAVED_WEEK_COUNT = 12;
const PERFORMED_COUNT = 2;

// Allenamenti dal più recente (25) al più vecchio (1): la prima pagina contiene 25..6.
export const WORKOUT_IDS = Array.from({ length: WORKOUT_COUNT }, (_, i) => WORKOUT_COUNT - i);

export function meWith(permissions: Permission[], role: Me["role"] = "user"): Me {
  return { id: 1, username: "simone", display_name: "Simone", role, permissions, mcp_url: "" };
}

export function workoutFixture(id: number): Workout {
  return {
    id,
    name: `Allenamento ${id}`,
    template_id: null,
    status: "finished",
    started_at: "2026-10-01T10:00:00.000Z",
    finished_at: "2026-10-01T11:00:00.000Z",
    rest_ends_at: null,
    rest_total_s: null,
    server_now: "2026-10-13T08:00:00.000Z",
    exercises: [],
    template_diff: [],
  };
}

function exerciseFixture(id: number): Exercise {
  return {
    id,
    name: `Esercizio ${id}`,
    equipment: null,
    primary_muscles: [],
    secondary_muscles: [],
    category: null,
    tracking: "weight_reps",
    custom: false,
  };
}

function dayFixture(date: string): DayResponse {
  return {
    date,
    entries: { breakfast: [], lunch: [], dinner: [], snack: [] },
    totals: { by_meal: {}, total: NUTRIMENTS },
    goal: null,
    delta: null,
  };
}

function weekFixture(start: string, end: string): WeekResponse {
  return { start, end, days: [] };
}

function weightFixture(start: string, end: string): WeightHistory {
  return { start, end, days: [], weeks: [] };
}

function historyPage(before: string | null): HistoryPage {
  const pageIds = before === null ? WORKOUT_IDS.slice(0, FIRST_PAGE_SIZE) : WORKOUT_IDS.slice(FIRST_PAGE_SIZE);
  return {
    items: pageIds.map((id) => ({
      id,
      name: `Allenamento ${id}`,
      started_at: "2026-10-01T10:00:00.000Z",
      finished_at: "2026-10-01T11:00:00.000Z",
      exercises: [],
    })),
    next_before: before === null ? "2026-10-01T10:00:00.000Z" : null,
  };
}

function templatesFixture(): TemplatesResponse {
  const templates = Array.from({ length: TEMPLATE_COUNT }, (_, i) => ({
    id: i + 1,
    name: `Modello ${i + 1}`,
    folder_id: null,
    last_used_at: null,
    exercise_names: [],
  }));
  return { folders: [], templates };
}

function templateFixture(id: number): Template {
  return { id, name: `Modello ${id}`, folder_id: null, last_used_at: null, exercises: [] };
}

function savedWeekSummaries(): SavedWeekSummary[] {
  return Array.from({ length: SAVED_WEEK_COUNT }, (_, i) => ({
    id: i + 1,
    name: `Settimana ${i + 1}`,
    created_at: "2026-10-01T10:00:00.000Z",
    entries_count: 0,
    avg_kcal: 0,
  }));
}

function savedWeekDetail(id: number): SavedWeekDetail {
  return { ...savedWeekSummaries()[id - 1], id, days: [] };
}

function performedExercises(): PerformedExercise[] {
  return Array.from({ length: PERFORMED_COUNT }, (_, i) => ({
    exercise_id: i + 1,
    name: `Esercizio ${i + 1}`,
    tracking: "weight_reps",
    custom: false,
    last_date: "2026-10-10",
  }));
}

const GOAL: Goal = { id: 1, kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 70, valid_from: "2026-01-01" };
const GYM_COUNT: GymCount = { finished: WORKOUT_COUNT };
const EXERCISE_LIST: ExerciseList = { items: [exerciseFixture(1), exerciseFixture(2)], total: 2 };

export type Reply = { status: number; body?: unknown } | { reject: Error };
export interface RouteContext {
  path: string;
  index: number;
  init?: RequestInit;
}
// Restituisce una risposta, o `undefined` per usare la fixture di default.
export type Responder = (ctx: RouteContext) => Reply | undefined | Promise<Reply | undefined>;

export interface RoutedFetch {
  fetch: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  // Percorsi chiamati, senza `/api`, nell'ordine di arrivo (con la query string).
  urls: string[];
}

const ok = (body: unknown): Reply => ({ status: 200, body });
const notFound: Reply = { status: 404, body: { detail: "not found" } };

// Risposta di default per ogni endpoint che il precarico usa. Un percorso sconosciuto risponde 404.
function fixtureFor(path: string): Reply {
  const { pathname, searchParams } = new URL(path, "http://yfp.local");
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const id = pathname.split("/").at(-1) ?? "";

  if (pathname.startsWith("/diary/day/")) return ok(dayFixture(id));
  if (pathname === "/diary/week") return ok(weekFixture(start, start));
  if (pathname === "/diary/range") return ok(weekFixture(start, end));
  if (pathname === "/goals") return ok(GOAL);
  if (pathname === "/stats/streak") return ok({ current: 3, best: 5 });
  if (pathname === "/weights/today") return { status: 204 };
  if (pathname === "/weights") return ok(weightFixture(start, end));
  if (pathname === "/saved-weeks") return ok(savedWeekSummaries());
  if (pathname.startsWith("/saved-weeks/")) return ok(savedWeekDetail(Number(id)));
  if (pathname === "/templates") return ok(templatesFixture());
  if (pathname.startsWith("/templates/")) return ok(templateFixture(Number(id)));
  if (pathname === "/exercises") return ok(EXERCISE_LIST);
  if (pathname === "/workouts") return ok(historyPage(searchParams.get("before")));
  if (pathname.startsWith("/workouts/") && /^\d+$/.test(id)) return ok(workoutFixture(Number(id)));
  if (pathname === "/stats/gym/count") return ok(GYM_COUNT);
  if (pathname === "/stats/gym") return ok({ start, end, workouts: 0, volume_kg: 0, avg_duration_min: null, weeks: [] } satisfies GymStats);
  if (pathname === "/stats/gym/exercises") return ok(performedExercises());
  if (pathname.startsWith("/stats/gym/exercises/")) {
    const progress: ExerciseProgress = {
      exercise_id: Number(id),
      name: `Esercizio ${id}`,
      tracking: "weight_reps",
      start,
      end,
      sessions: [],
      records: [],
    };
    return ok(progress);
  }
  return notFound;
}

function responseOf(reply: { status: number; body?: unknown }): Response {
  return {
    ok: reply.status < 400,
    status: reply.status,
    // Come il client: solo un corpo JSON si legge; 204 e risposte non JSON non vengono letti.
    json: () => (reply.body === undefined ? Promise.reject(new SyntaxError("no json")) : Promise.resolve(reply.body)),
  } as unknown as Response;
}

// `overrides` è indicizzato per percorso senza query string, oppure "*" per tutte le richieste senza sovrascrittura.
export function routeFetch(overrides: Record<string, Reply | Responder> = {}): RoutedFetch {
  const urls: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, "");
    const pathname = new URL(path, "http://yfp.local").pathname;
    const index = urls.length;
    urls.push(path);
    const override = overrides[pathname] ?? overrides["*"];
    const reply = typeof override === "function" ? await override({ path, index, init }) : override;
    const result = reply ?? fixtureFor(path);
    if ("reject" in result) throw result.reject;
    return responseOf(result);
  });
  return { fetch, urls };
}
