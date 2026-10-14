import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import {
  type ConflictBody,
  deleteWorkoutChecked,
  fetchOfflineSnapshot,
  gymKeys,
  putWorkout,
  type WorkoutPutBody,
} from "./gym";

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

const body: WorkoutPutBody = {
  base_version: 2,
  name: "Push",
  template_id: null,
  status: "finished",
  started_at: "2026-10-14T10:00:00+00:00",
  finished_at: "2026-10-14T11:00:00+00:00",
  rest_ends_at: null,
  rest_total_s: null,
  exercises: [
    {
      uuid: "3f2b1c0e-0000-4000-8000-000000000001",
      exercise_id: 7,
      rest_seconds: 90,
      superset_group: null,
      note: null,
      sets: [
        {
          uuid: "3f2b1c0e-0000-4000-8000-000000000002",
          weight_kg: 60,
          reps: 8,
          duration_s: null,
          completed_at: "2026-10-14T10:05:00+00:00",
        },
      ],
    },
  ],
};

describe("offline sync requests", () => {
  it("fetchOfflineSnapshot requests the snapshot with GET", async () => {
    await fetchOfflineSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/workouts/offline-snapshot");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("putWorkout sends the whole body as JSON to the workout uuid with PUT", async () => {
    await putWorkout("3f2b1c0e-0000-4000-8000-000000000000", body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/workouts/3f2b1c0e-0000-4000-8000-000000000000");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it("putWorkout rejects with ApiError carrying the 409 body", async () => {
    const conflict: ConflictBody = { detail: "version_conflict", current: null };
    fetchMock.mockResolvedValue(response(409, conflict));

    const error = await putWorkout("3f2b1c0e-0000-4000-8000-000000000000", body).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: "version_conflict", body: conflict });
  });

  it("deleteWorkoutChecked sends base_version as a query parameter with DELETE", async () => {
    fetchMock.mockResolvedValue(response(204));

    await expect(deleteWorkoutChecked(12, 3)).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/workouts/12?base_version=3");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });
});

describe("gymKeys.offlineSnapshot", () => {
  it("is the stable query key of the snapshot", () => {
    expect(gymKeys.offlineSnapshot).toEqual(["gym", "offline-snapshot"]);
  });
});
