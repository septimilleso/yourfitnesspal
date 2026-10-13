import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_FILTERS,
  fetchExerciseProgress,
  fetchExercises,
  fetchGymCount,
  fetchGymStats,
  fetchHistoryPage,
  fetchPerformedExercises,
  fetchTemplate,
  fetchTemplates,
  fetchWorkout,
} from "./gym";
import { fetchDayDiary, fetchDiaryRange, fetchGoal, fetchStreak, fetchWeekDiary } from "./queries";
import { fetchSavedWeek, fetchSavedWeeks } from "./savedWeeks";
import { fetchTodayWeight, fetchWeightHistory } from "./weights";

const fetchMock = vi.fn<typeof fetch>();

// Risposta minimale: il client usa solo ok, status e json().
function response(status: number, body?: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError("no json")) : Promise.resolve(body)),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(response(200, {}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const cases = [
  { name: "fetchDayDiary", call: () => fetchDayDiary("2026-10-12"), url: "/api/diary/day/2026-10-12" },
  { name: "fetchWeekDiary", call: () => fetchWeekDiary("2026-10-05"), url: "/api/diary/week?start=2026-10-05" },
  {
    name: "fetchDiaryRange",
    call: () => fetchDiaryRange("2026-10-01", "2026-10-07"),
    url: "/api/diary/range?start=2026-10-01&end=2026-10-07",
  },
  { name: "fetchStreak", call: () => fetchStreak(), url: "/api/stats/streak" },
  {
    name: "fetchWeightHistory",
    call: () => fetchWeightHistory("2026-10-01", "2026-10-07"),
    url: "/api/weights?start=2026-10-01&end=2026-10-07",
  },
  { name: "fetchSavedWeeks", call: () => fetchSavedWeeks(), url: "/api/saved-weeks" },
  { name: "fetchSavedWeek", call: () => fetchSavedWeek(4), url: "/api/saved-weeks/4" },
  { name: "fetchTemplates", call: () => fetchTemplates(), url: "/api/templates" },
  { name: "fetchTemplate", call: () => fetchTemplate(9), url: "/api/templates/9" },
  {
    name: "fetchExercises (filtri)",
    call: () => fetchExercises({ ...EMPTY_FILTERS, q: "  panca ", muscle: "chest" }),
    url: "/api/exercises?limit=200&q=panca&muscle=chest",
  },
  { name: "fetchHistoryPage (prima pagina)", call: () => fetchHistoryPage(null), url: "/api/workouts?limit=20" },
  {
    name: "fetchHistoryPage (pagina successiva)",
    call: () => fetchHistoryPage("2026-10-01T10:00:00+00:00"),
    url: "/api/workouts?limit=20&before=2026-10-01T10%3A00%3A00%2B00%3A00",
  },
  { name: "fetchWorkout", call: () => fetchWorkout(12), url: "/api/workouts/12" },
  { name: "fetchGymCount", call: () => fetchGymCount(), url: "/api/stats/gym/count" },
  {
    name: "fetchGymStats",
    call: () => fetchGymStats("2026-10-01", "2026-10-07"),
    url: "/api/stats/gym?start=2026-10-01&end=2026-10-07",
  },
  { name: "fetchPerformedExercises", call: () => fetchPerformedExercises(), url: "/api/stats/gym/exercises" },
  {
    name: "fetchExerciseProgress",
    call: () => fetchExerciseProgress(7, "2026-10-01", "2026-10-07"),
    url: "/api/stats/gym/exercises/7?start=2026-10-01&end=2026-10-07",
  },
];

describe("fetch functions request the same URL as before", () => {
  it.each(cases)("$name requests $url", async ({ call, url }) => {
    await call();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url);
  });
});

describe("fetch functions with special responses", () => {
  it("fetchGoal resolves null when the backend has no goal (404)", async () => {
    fetchMock.mockResolvedValue(response(404, { detail: "Not found" }));

    await expect(fetchGoal()).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/goals");
  });

  it("fetchGoal rethrows errors other than 404", async () => {
    fetchMock.mockResolvedValue(response(500, { detail: "boom" }));

    await expect(fetchGoal()).rejects.toThrow("boom");
  });

  it("fetchTodayWeight resolves null on 204", async () => {
    fetchMock.mockResolvedValue(response(204));

    await expect(fetchTodayWeight()).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/weights/today");
  });
});
