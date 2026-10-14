import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError } from "../api/client";
import type { Exercise, Template, Workout, WorkoutPutBody } from "../api/gym";
import { gymKeys } from "../api/gym";
import { clearGymStore, dispatch, getSnapshot, startWorkoutFromTemplate } from "./gymStore";
import { syncEntry } from "./gymSync";

const api = vi.hoisted(() => ({ putWorkout: vi.fn() }));

vi.mock("../api/gym", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/gym")>()),
  putWorkout: api.putWorkout,
}));

const NOW = Date.parse("2026-10-14T10:00:00.000Z");
// Il server è avanti di 5 s: lo scarto d'orologio atteso è 5000 ms.
const SERVER_NOW = "2026-10-14T10:00:05.000Z";

const PANCA: Exercise = {
  id: 1,
  name: "Panca piana",
  equipment: "bilanciere",
  primary_muscles: ["petto"],
  secondary_muscles: [],
  category: null,
  tracking: "weight_reps",
  custom: false,
};

const TEMPLATE: Template = {
  id: 3,
  name: "Giorno A",
  folder_id: null,
  last_used_at: null,
  exercises: [
    {
      id: 11,
      exercise: PANCA,
      rest_seconds: 120,
      superset_group: null,
      note: "nota del modello",
      sets: [{ weight_kg: 50, reps: 8, duration_s: null }],
    },
  ],
};

// Risposta del server costruita dal corpo ricevuto: stesso uuid, ids nuovi, versione base + 1.
function serverCopy(uuid: string, body: WorkoutPutBody, extra: Partial<Workout> = {}): Workout {
  return {
    id: 42,
    uuid,
    version: (body.base_version ?? 0) + 1,
    name: body.name,
    template_id: body.template_id,
    status: body.status,
    started_at: body.started_at,
    finished_at: body.finished_at,
    rest_ends_at: body.rest_ends_at,
    rest_total_s: body.rest_total_s,
    server_now: SERVER_NOW,
    template_diff: [],
    exercises: body.exercises.map((exercise, i) => ({
      id: 500 + i,
      uuid: exercise.uuid,
      exercise: { ...PANCA, id: exercise.exercise_id },
      rest_seconds: exercise.rest_seconds,
      superset_group: exercise.superset_group,
      note: exercise.note,
      sets: exercise.sets.map((set, j) => ({
        id: 900 + 10 * i + j,
        uuid: set.uuid,
        weight_kg: set.weight_kg,
        reps: set.reps,
        duration_s: set.duration_s,
        completed_at: set.completed_at,
        previous: null,
        max_set: null,
      })),
    })),
    ...extra,
  };
}

function lastBody(): WorkoutPutBody {
  const call = api.putWorkout.mock.calls.at(-1);
  if (call === undefined) throw new Error("nessun PUT inviato");
  return call[1] as WorkoutPutBody;
}

// Avvia dal modello e restituisce l'uuid dell'allenamento.
function startedFromTemplate(): string {
  const outcome = startWorkoutFromTemplate(TEMPLATE);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.state.uuid;
}

// Avvia dal modello, completa la prima serie e finisce: il finito resta nello store finché non è sincronizzato.
function finishedLocally(): string {
  const uuid = startedFromTemplate();
  const setUuid = getSnapshot().active?.workout.exercises[0].sets[0].uuid ?? "";
  expect(dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } }).ok).toBe(true);
  expect(dispatch(uuid, { type: "finish", discardIncomplete: false }).ok).toBe(true);
  expect(getSnapshot().finished).toHaveLength(1);
  return uuid;
}

let queryClient: QueryClient;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  api.putWorkout.mockReset();
  queryClient = new QueryClient();
  // Nel browser lo store è solo in memoria: il reset lo riporta vuoto.
  await clearGymStore();
});

describe("invio del PUT", () => {
  it("manda il corpo senza id, nome e tracking degli esercizi, con base_version null per un allenamento nuovo", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));

    await syncEntry(uuid, queryClient);

    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    const [sentUuid, body] = api.putWorkout.mock.calls[0] as [string, WorkoutPutBody];
    expect(sentUuid).toBe(uuid);
    expect(body.base_version).toBeNull();
    expect(body.name).toBe("Giorno A");
    expect(body.started_at).toMatch(/\+00:00$/);
    expect(body).not.toHaveProperty("id");
    expect(body).not.toHaveProperty("version");
    expect(body.exercises).toEqual([
      {
        uuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
        exercise_id: 1,
        rest_seconds: 120,
        superset_group: null,
        note: "nota del modello",
        sets: [
          {
            uuid: expect.stringMatching(/^[0-9a-f-]{36}$/),
            weight_kg: 50,
            reps: 8,
            duration_s: null,
            completed_at: null,
          },
        ],
      },
    ]);
    expect(body.exercises[0]).not.toHaveProperty("id");
    expect(body.exercises[0]).not.toHaveProperty("name");
    expect(body.exercises[0]).not.toHaveProperty("tracking");
    expect(body.exercises[0].sets[0]).not.toHaveProperty("id");
  });

  it("con 201 l'allenamento nuovo prende ids, baseVersion e scarto d'orologio, e resta attivo e sincronizzato", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));

    const outcome = await syncEntry(uuid, queryClient);

    expect(outcome).toBe("synced");
    const entry = getSnapshot().active;
    expect(entry).toMatchObject({ baseVersion: 1, sync: "synced", conflict: null, sentRevision: entry?.revision });
    expect(entry?.workout).toMatchObject({ id: 42, uuid, version: 1, name: "Giorno A" });
    expect(entry?.workout.exercises[0]).toMatchObject({ id: 500, name: "Panca piana", tracking: "weight_reps" });
    expect(entry?.workout.exercises[0].sets[0]).toMatchObject({ id: 900, weight_kg: 50, reps: 8 });
    expect(entry?.lastServer?.id).toBe(42);
    expect(getSnapshot().clockOffsetMs).toBe(5000);
  });
});

describe("esito 200 o 201 (C24)", () => {
  it("senza modifiche durante il volo lo stato locale diventa la risposta del server", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => {
      const copy = serverCopy(sent, body);
      return {
        ...copy,
        exercises: [
          {
            ...copy.exercises[0],
            sets: [
              {
                id: 77,
                uuid: body.exercises[0].sets[0].uuid,
                weight_kg: 50.5,
                reps: 8,
                duration_s: null,
                completed_at: null,
                previous: { weight_kg: 47.5, reps: 8, duration_s: null },
                max_set: { weight_kg: 55, reps: 6, duration_s: null },
              },
            ],
          },
        ],
      };
    });

    await syncEntry(uuid, queryClient);

    const entry = getSnapshot().active;
    expect(entry?.workout.exercises[0].sets[0]).toMatchObject({ id: 77, weight_kg: 50.5 });
    expect(entry?.lastServer?.exercises[0].sets[0].max_set).toEqual({ weight_kg: 55, reps: 6, duration_s: null });
    expect(entry?.sync).toBe("synced");
    expect(entry?.sentRevision).toBe(entry?.revision);
  });

  it("con una modifica durante il volo la modifica resta, la voce resta pending e il secondo PUT usa la nuova baseVersion", async () => {
    const uuid = startedFromTemplate();
    let resolveFirst: (value: Workout) => void = () => undefined;
    api.putWorkout.mockImplementationOnce(
      () =>
        new Promise<Workout>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const first = syncEntry(uuid, queryClient);
    const firstBody = lastBody();
    expect(dispatch(uuid, { type: "rename", name: "Gambe" }).ok).toBe(true);
    resolveFirst(serverCopy(uuid, firstBody));
    await expect(first).resolves.toBe("pending");

    const afterFirst = getSnapshot().active;
    expect(afterFirst).toMatchObject({ baseVersion: 1, sync: "pending", revision: 2, sentRevision: 1 });
    expect(afterFirst?.workout).toMatchObject({ id: 42, name: "Gambe", version: 1 });
    expect(afterFirst?.lastServer?.id).toBe(42);

    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));
    await expect(syncEntry(uuid, queryClient)).resolves.toBe("synced");

    expect(api.putWorkout).toHaveBeenCalledTimes(2);
    expect(lastBody()).toMatchObject({ base_version: 1, name: "Gambe" });
    expect(getSnapshot().active).toMatchObject({ baseVersion: 2, sync: "synced" });
  });
});

describe("allenamento finito confermato (C26)", () => {
  it("esce dallo store, mette la risposta in ['gym','workout',id] e invalida storico, statistiche, modelli e snapshot", async () => {
    const uuid = finishedLocally();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) =>
      serverCopy(sent, body, {
        status: "finished",
        finished_at: "2026-10-14T10:30:00+00:00",
        rest_ends_at: null,
        rest_total_s: null,
      }),
    );

    const outcome = await syncEntry(uuid, queryClient);

    expect(outcome).toBe("synced");
    expect(getSnapshot().finished).toHaveLength(0);
    expect(getSnapshot().active).toBeNull();
    expect(queryClient.getQueryData<Workout>(gymKeys.workout(42))).toMatchObject({ id: 42, status: "finished" });
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([gymKeys.history, ["gym", "stats"], gymKeys.templates, gymKeys.offlineSnapshot]),
    );
  });
});

describe("esiti di errore", () => {
  it("409 version_conflict porta l'allenamento in conflitto con motivo e copia del server, senza altri PUT", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => {
      const current = serverCopy(sent, body, { version: 5 });
      throw new ApiError(409, "version_conflict", { detail: "version_conflict", current });
    });

    const outcome = await syncEntry(uuid, queryClient);

    expect(outcome).toBe("conflict");
    const entry = getSnapshot().active;
    expect(entry).toMatchObject({
      sync: "conflict",
      baseVersion: null,
      conflict: { reason: "version_conflict", current: { id: 42, version: 5 } },
    });
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
  });

  it("409 other_active con current null conserva il motivo", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new ApiError(409, "other_active", { detail: "other_active", current: null }));

    await syncEntry(uuid, queryClient);

    expect(getSnapshot().active?.conflict).toEqual({ reason: "other_active", current: null });
    expect(getSnapshot().active?.sync).toBe("conflict");
  });

  it("altro 4xx porta l'allenamento in errore di sincronizzazione e lascia i dati sul telefono (C27)", async () => {
    const uuid = startedFromTemplate();
    const before = getSnapshot().active;
    api.putWorkout.mockRejectedValueOnce(new ApiError(400, "Invalid", { detail: "Invalid" }));

    const outcome = await syncEntry(uuid, queryClient);

    expect(outcome).toBe("error");
    const entry = getSnapshot().active;
    expect(entry).toMatchObject({ sync: "error", baseVersion: before?.baseVersion, revision: before?.revision });
    expect(entry?.workout).toEqual(before?.workout);
  });

  it("il successivo sync di un allenamento in errore riprova il PUT (C27)", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new ApiError(400, "Invalid", { detail: "Invalid" }));
    await syncEntry(uuid, queryClient);
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));

    await expect(syncEntry(uuid, queryClient)).resolves.toBe("synced");

    expect(api.putWorkout).toHaveBeenCalledTimes(2);
    expect(getSnapshot().active?.sync).toBe("synced");
  });

  it("5xx e errore di rete lasciano l'allenamento pending senza cambiare il resto", async () => {
    const uuid = startedFromTemplate();
    const before = getSnapshot().active;
    api.putWorkout.mockRejectedValueOnce(new ApiError(503, "Service Unavailable", null));
    await expect(syncEntry(uuid, queryClient)).resolves.toBe("pending");
    expect(getSnapshot().active).toMatchObject({ sync: "pending", baseVersion: before?.baseVersion, revision: before?.revision });

    api.putWorkout.mockRejectedValueOnce(new NetworkError("network"));
    await expect(syncEntry(uuid, queryClient)).resolves.toBe("pending");
    expect(getSnapshot().active).toMatchObject({ sync: "pending", revision: before?.revision });
    expect(getSnapshot().active?.workout).toEqual(before?.workout);
  });

  it("un errore di rete su un finito non lo toglie dallo store", async () => {
    const uuid = finishedLocally();
    api.putWorkout.mockRejectedValueOnce(new NetworkError("network"));

    await expect(syncEntry(uuid, queryClient)).resolves.toBe("pending");

    expect(getSnapshot().finished).toHaveLength(1);
    expect(getSnapshot().finished[0].sync).toBe("pending");
  });

  it("401 non cambia lo store", async () => {
    const uuid = startedFromTemplate();
    const before = getSnapshot();
    api.putWorkout.mockRejectedValueOnce(new ApiError(401, "unauthorized", { detail: "unauthorized" }));

    const outcome = await syncEntry(uuid, queryClient);

    expect(outcome).toBe("unauthorized");
    expect(getSnapshot()).toBe(before);
  });

  it("un uuid senza voce locale non invia nulla", async () => {
    await expect(syncEntry("00000000-0000-4000-8000-000000000000", queryClient)).resolves.toBe("missing");
    expect(api.putWorkout).not.toHaveBeenCalled();
  });
});
