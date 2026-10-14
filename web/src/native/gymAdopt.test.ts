import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError } from "../api/client";
import type { Exercise, Template, Workout, WorkoutPutBody } from "../api/gym";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "./connectivity";
import { addPendingDelete, clearGymStore, dispatch, getSnapshot, removePendingDelete, startWorkoutFromTemplate } from "./gymStore";
import { adoptServerActive, startGymSync, syncEntry } from "./gymSync";
import { clearToken, setToken } from "./session";

const platform = vi.hoisted(() => ({ native: true }));
const preferences = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
}));
const api = vi.hoisted(() => ({ fetchActiveWorkout: vi.fn(), putWorkout: vi.fn() }));

vi.mock("./platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("../api/gym", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/gym")>()),
  fetchActiveWorkout: api.fetchActiveWorkout,
  putWorkout: api.putWorkout,
}));

const NOW = Date.parse("2026-10-14T10:00:00.000Z");
const SERVER_NOW = "2026-10-14T10:00:05.000Z";
// Il server è avanti di 5 s: lo scarto d'orologio atteso è 5000 ms.
const CLOCK_OFFSET = 5000;
const SETTLE_MS = 1000;
const UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";
const EXERCISE_UUID = "33333333-3333-4333-8333-333333333333";
const SET_UUID = "44444444-4444-4444-8444-444444444444";

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
      note: null,
      sets: [{ weight_kg: 50, reps: 8, duration_s: null }],
    },
  ],
};

// Allenamento attivo come lo restituisce `GET /workouts/active` (WorkoutOut).
function serverWorkout(uuid: string, version: number, extra: Partial<Workout> = {}): Workout {
  return {
    id: 42,
    uuid,
    version,
    name: "Allenamento web",
    template_id: null,
    status: "in_progress",
    started_at: "2026-10-14T09:30:00.000+00:00",
    finished_at: null,
    rest_ends_at: null,
    rest_total_s: null,
    server_now: SERVER_NOW,
    template_diff: [],
    exercises: [
      {
        id: 500,
        uuid: EXERCISE_UUID,
        exercise: PANCA,
        rest_seconds: 120,
        superset_group: null,
        note: null,
        sets: [{ id: 900, uuid: SET_UUID, weight_kg: 50, reps: 8, duration_s: null, completed_at: null, previous: null, max_set: null }],
      },
    ],
    ...extra,
  };
}

// Risposta del PUT costruita dal corpo ricevuto: ids nuovi, versione base + 1.
function serverCopy(uuid: string, body: WorkoutPutBody): Workout {
  return {
    ...serverWorkout(uuid, (body.base_version ?? 0) + 1),
    name: body.name,
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
  };
}

function accepted(sent: string, body: WorkoutPutBody): Promise<Workout> {
  return Promise.resolve(serverCopy(sent, body));
}

function startedFromTemplate(): string {
  const outcome = startWorkoutFromTemplate(TEMPLATE);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.state.uuid;
}

// Avvia dal modello e lo invia: resta sul telefono sincronizzato e senza modifiche (baseVersion 1).
async function syncedLocally(queryClient: QueryClient): Promise<string> {
  const uuid = startedFromTemplate();
  api.putWorkout.mockImplementationOnce(accepted);
  expect(await syncEntry(uuid, queryClient)).toBe("synced");
  return uuid;
}

// Sincronizzato una volta (baseVersion 1), poi finito offline e ancora in attesa di sync.
async function syncedThenFinishedLocally(queryClient: QueryClient): Promise<string> {
  const uuid = await syncedLocally(queryClient);
  const setUuid = getSnapshot().active?.workout.exercises[0]?.sets[0]?.uuid ?? "";
  expect(dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } }).ok).toBe(true);
  expect(dispatch(uuid, { type: "finish", discardIncomplete: false }).ok).toBe(true);
  expect(getSnapshot().finished).toHaveLength(1);
  return uuid;
}

function rename(uuid: string, name: string): void {
  expect(dispatch(uuid, { type: "rename", name }).ok).toBe(true);
}

function lastBody(): WorkoutPutBody {
  const call = api.putWorkout.mock.calls.at(-1);
  if (call === undefined) throw new Error("nessun PUT inviato");
  return call[1] as WorkoutPutBody;
}

// Lascia girare le promise e i timer a zero ritardo finché il giro non si ferma.
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
}

let queryClient: QueryClient;
let stop: (() => void) | undefined;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  platform.native = true;
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue(undefined);
  filesystem.deleteFile.mockResolvedValue(undefined);
  filesystem.rename.mockResolvedValue(undefined);
  filesystem.stat.mockResolvedValue({});
  // Di default il server non ha un allenamento attivo: `GET /workouts/active` risponde 204.
  api.fetchActiveWorkout.mockReset();
  api.fetchActiveWorkout.mockResolvedValue(null);
  api.putWorkout.mockReset();
  queryClient = new QueryClient();
  await clearGymStore();
  await setToken("tok-a");
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  resetConnectivityForTests();
  Reflect.deleteProperty(document, "visibilityState");
  await clearToken();
  vi.useRealTimers();
});

describe("adozione dell'allenamento attivo del server (R17, C28)", () => {
  it("C28: senza stato locale adotta l'attivo del server e una modifica arriva con PUT su quell'uuid e la base_version letta", async () => {
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(UUID, 3));

    expect(await adoptServerActive()).toBe("adopted");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 3, sync: "synced", revision: 0, sentRevision: 0, conflict: null });
    expect(getSnapshot().active?.workout).toMatchObject({ uuid: UUID, id: 42, version: 3, name: "Allenamento web" });
    expect(getSnapshot().active?.lastServer).toMatchObject({ id: 42, uuid: UUID, version: 3 });
    expect(getSnapshot().clockOffsetMs).toBe(CLOCK_OFFSET);

    rename(UUID, "Dal telefono");
    api.putWorkout.mockImplementationOnce(accepted);
    expect(await syncEntry(UUID, queryClient)).toBe("synced");
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    expect(api.putWorkout.mock.calls[0]?.[0]).toBe(UUID);
    expect(lastBody()).toMatchObject({ base_version: 3, name: "Dal telefono" });
  });

  it("C28 con l'apertura: l'adozione avviene prima dei PUT e la modifica successiva parte con la base_version del server", async () => {
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(UUID, 3));
    api.putWorkout.mockImplementation(accepted);

    stop = startGymSync(queryClient);
    await settle();
    expect(api.fetchActiveWorkout).toHaveBeenCalledTimes(1);
    expect(api.putWorkout).not.toHaveBeenCalled();
    expect(getSnapshot().active?.workout.uuid).toBe(UUID);

    rename(UUID, "Dal telefono");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    expect(api.putWorkout.mock.calls[0]?.[0]).toBe(UUID);
    expect(lastBody()).toMatchObject({ base_version: 3, name: "Dal telefono" });
  });

  it("stesso uuid senza modifiche e versione più alta: adotta la copia del server", async () => {
    const uuid = await syncedLocally(queryClient);
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(uuid, 4, { name: "Dal web" }));

    expect(await adoptServerActive()).toBe("adopted");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 4, sync: "synced", conflict: null });
    expect(getSnapshot().active?.revision).toBe(getSnapshot().active?.sentRevision);
    expect(getSnapshot().active?.workout).toMatchObject({ name: "Dal web", version: 4, id: 42 });
    expect(getSnapshot().active?.lastServer).toMatchObject({ version: 4, name: "Dal web" });
  });

  it("stesso uuid con la stessa versione: non cambia nulla, ma aggiorna lo scarto d'orologio", async () => {
    const uuid = await syncedLocally(queryClient);
    const before = getSnapshot().active;
    // Il server dice 7 s avanti: il valore nuovo è 7000 ms, diverso da quello del PUT (5000 ms).
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(uuid, before?.baseVersion ?? 0, { server_now: "2026-10-14T10:00:07.000Z" }));

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toBe(before);
    expect(getSnapshot().clockOffsetMs).toBe(7000);
  });

  it("modifiche in attesa: non adotta anche con una versione più alta", async () => {
    const uuid = await syncedLocally(queryClient);
    rename(uuid, "Telefono");
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(uuid, 4, { name: "Dal web" }));

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 1, sync: "pending" });
    expect(getSnapshot().active?.workout.name).toBe("Telefono");
  });

  it("uuid diverso con locale pulito: il server vince, il locale si scarta e si adotta quello del server", async () => {
    const uuid = await syncedLocally(queryClient);
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(OTHER_UUID, 5));

    expect(await adoptServerActive()).toBe("adopted");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 5, sync: "synced", revision: 0, sentRevision: 0 });
    expect(getSnapshot().active?.workout.uuid).toBe(OTHER_UUID);
    expect(getSnapshot().finished.some((entry) => entry.workout.uuid === uuid)).toBe(false);
  });

  it("uuid diverso con modifiche in attesa: non adotta, il PUT successivo darà other_active", async () => {
    const uuid = await syncedLocally(queryClient);
    rename(uuid, "Telefono");
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(OTHER_UUID, 5));

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 1, sync: "pending" });
    expect(getSnapshot().active?.workout.uuid).toBe(uuid);
  });

  it("nessun attivo sul server e locale sincronizzato senza modifiche: rimuove il locale", async () => {
    await syncedLocally(queryClient);
    api.fetchActiveWorkout.mockResolvedValueOnce(null);

    expect(await adoptServerActive()).toBe("removed");

    expect(getSnapshot().active).toBeNull();
  });

  it("nessun attivo sul server ma modifiche in attesa: il locale resta", async () => {
    const uuid = await syncedLocally(queryClient);
    rename(uuid, "Ancora da inviare");
    api.fetchActiveWorkout.mockResolvedValueOnce(null);

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toMatchObject({ sync: "pending" });
    expect(getSnapshot().active?.workout.name).toBe("Ancora da inviare");
  });

  it("nessun attivo sul server e locale mai inviato: il locale resta, il PUT lo crea", async () => {
    const uuid = startedFromTemplate();
    api.fetchActiveWorkout.mockResolvedValueOnce(null);

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toMatchObject({ baseVersion: null, sync: "pending" });
    expect(getSnapshot().active?.workout.uuid).toBe(uuid);
  });

  it("nessun locale e nessun attivo sul server: non fa nulla e non cambia l'orologio", async () => {
    api.fetchActiveWorkout.mockResolvedValueOnce(null);

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().clockOffsetMs).toBe(0);
  });

  it("una modifica locale arrivata durante la GET (nessun locale) non viene sovrascritta", async () => {
    api.fetchActiveWorkout.mockImplementationOnce(async () => {
      startedFromTemplate();
      return serverWorkout(UUID, 3);
    });

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active?.workout.uuid).not.toBe(UUID);
    expect(getSnapshot().active?.baseVersion).toBeNull();
  });

  it("una modifica locale arrivata durante la GET (stesso uuid) non viene sovrascritta", async () => {
    const uuid = await syncedLocally(queryClient);
    api.fetchActiveWorkout.mockImplementationOnce(async () => {
      rename(uuid, "Durante la GET");
      return serverWorkout(uuid, 4, { name: "Dal web" });
    });

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 1, sync: "pending" });
    expect(getSnapshot().active?.workout.name).toBe("Durante la GET");
  });

  it("401: esito unauthorized e stato locale intatto", async () => {
    const uuid = await syncedLocally(queryClient);
    api.fetchActiveWorkout.mockRejectedValueOnce(new ApiError(401, "unauthorized", { detail: "unauthorized" }));

    expect(await adoptServerActive()).toBe("unauthorized");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 1, sync: "synced" });
    expect(getSnapshot().active?.workout.uuid).toBe(uuid);
  });

  it("5xx e rete assente: esito failed, senza lanciare e senza toccare lo stato", async () => {
    const uuid = await syncedLocally(queryClient);
    const offsetBefore = getSnapshot().clockOffsetMs;
    api.fetchActiveWorkout.mockRejectedValueOnce(new ApiError(503, "Service Unavailable", null));
    expect(await adoptServerActive()).toBe("failed");
    api.fetchActiveWorkout.mockRejectedValueOnce(new NetworkError("network"));
    expect(await adoptServerActive()).toBe("failed");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 1, sync: "synced" });
    expect(getSnapshot().active?.workout.uuid).toBe(uuid);
    expect(getSnapshot().clockOffsetMs).toBe(offsetBefore);
  });

  it("offline: esito failed senza chiamare il server", async () => {
    reportNetworkFailure();

    expect(await adoptServerActive()).toBe("failed");

    expect(api.fetchActiveWorkout).not.toHaveBeenCalled();
  });
});

describe("adozione e stato locale che cambia (R16, R17, R20)", () => {
  it("finito in attesa con lo stesso uuid ancora in corso sul server: non lo riadotta", async () => {
    const uuid = await syncedThenFinishedLocally(queryClient);
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(uuid, 1));

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().finished).toHaveLength(1);
    expect(getSnapshot().finished[0]).toMatchObject({ baseVersion: 1, sync: "pending" });
  });

  it("finito in attesa con lo stesso uuid sul server: all'apertura parte il PUT del finito, non quello di un attivo", async () => {
    const uuid = await syncedThenFinishedLocally(queryClient);
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(uuid, 1));
    // Il PUT della sincronizzazione precedente è già nel conteggio: si riparte da zero.
    api.putWorkout.mockClear();
    api.putWorkout.mockImplementation(accepted);

    stop = startGymSync(queryClient);
    await settle();

    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    expect(api.putWorkout.mock.calls[0]?.[0]).toBe(uuid);
    expect(lastBody()).toMatchObject({ base_version: 1, status: "finished" });
    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().finished).toHaveLength(0);
  });

  it("un PUT di creazione completato durante la GET non viene annullato da una risposta senza attivo", async () => {
    const uuid = startedFromTemplate();
    api.fetchActiveWorkout.mockImplementationOnce(async () => {
      api.putWorkout.mockImplementationOnce(accepted);
      expect(await syncEntry(uuid, queryClient)).toBe("synced");
      return null;
    });

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 1, sync: "synced" });
    expect(getSnapshot().active?.workout.uuid).toBe(uuid);
  });

  it("un PUT completato durante la GET: la copia del server, letta prima, non sovrascrive la versione locale", async () => {
    const uuid = await syncedLocally(queryClient);
    api.fetchActiveWorkout.mockImplementationOnce(async () => {
      rename(uuid, "Durante la GET");
      api.putWorkout.mockImplementationOnce(accepted);
      expect(await syncEntry(uuid, queryClient)).toBe("synced");
      // Risposta di una versione più alta, ma letta prima del PUT: non si applica in questo giro.
      return serverWorkout(uuid, 4, { name: "Dal web" });
    });

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toMatchObject({ baseVersion: 2, sync: "synced" });
    expect(getSnapshot().active?.workout.name).toBe("Durante la GET");
  });

  it("annullamento offline in attesa per lo stesso id: il server non lo riadotta", async () => {
    addPendingDelete({ id: 42, baseVersion: 1 });
    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(UUID, 3));

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toBeNull();
  });

  it("finito in attesa che si sincronizza durante la GET: la risposta, letta prima, non lo riadotta", async () => {
    const uuid = await syncedThenFinishedLocally(queryClient);
    api.fetchActiveWorkout.mockImplementationOnce(async () => {
      // Il PUT del finito completa mentre la GET è in volo: il server lo ha già chiuso.
      api.putWorkout.mockImplementationOnce(accepted);
      expect(await syncEntry(uuid, queryClient)).toBe("synced");
      // La risposta è servita prima del PUT e dice ancora in corso.
      return serverWorkout(uuid, 1);
    });

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().finished).toHaveLength(0);
  });

  it("annullamento offline consumato durante la GET: la risposta, letta prima, non riadotta lo stesso id", async () => {
    addPendingDelete({ id: 42, baseVersion: 1 });
    api.fetchActiveWorkout.mockImplementationOnce(async () => {
      removePendingDelete(42);
      return serverWorkout(UUID, 3);
    });

    expect(await adoptServerActive()).toBe("unchanged");

    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().pendingDeletes).toHaveLength(0);
  });

  it("adozione fallita all'apertura (offline): al ritorno della rete la rifà", async () => {
    reportNetworkFailure();
    stop = startGymSync(queryClient);
    await settle();
    expect(api.fetchActiveWorkout).not.toHaveBeenCalled();

    api.fetchActiveWorkout.mockResolvedValueOnce(serverWorkout(UUID, 3));
    reportNetworkSuccess();
    await settle();

    expect(api.fetchActiveWorkout).toHaveBeenCalledTimes(1);
    expect(getSnapshot().active?.workout.uuid).toBe(UUID);
  });

  it("adozione riuscita: il ritorno della rete non rifà la GET", async () => {
    stop = startGymSync(queryClient);
    await settle();
    expect(api.fetchActiveWorkout).toHaveBeenCalledTimes(1);

    reportNetworkFailure();
    reportNetworkSuccess();
    await settle();

    expect(api.fetchActiveWorkout).toHaveBeenCalledTimes(1);
  });
});

describe("adozione e PUT all'apertura (R17, R15)", () => {
  it("all'apertura, con la GET in errore 5xx, i PUT partono lo stesso", async () => {
    startedFromTemplate();
    api.fetchActiveWorkout.mockRejectedValueOnce(new ApiError(500, "Internal Server Error", null));
    api.putWorkout.mockImplementation(accepted);

    stop = startGymSync(queryClient);
    await settle();

    expect(api.fetchActiveWorkout).toHaveBeenCalledTimes(1);
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    const getOrder = api.fetchActiveWorkout.mock.invocationCallOrder[0] ?? Infinity;
    const putOrder = api.putWorkout.mock.invocationCallOrder[0] ?? 0;
    expect(getOrder).toBeLessThan(putOrder);
  });

  it("all'apertura, con la GET in 401, nessun PUT parte", async () => {
    startedFromTemplate();
    api.fetchActiveWorkout.mockRejectedValueOnce(new ApiError(401, "unauthorized", { detail: "unauthorized" }));
    api.putWorkout.mockImplementation(accepted);

    stop = startGymSync(queryClient);
    await settle();

    expect(api.fetchActiveWorkout).toHaveBeenCalledTimes(1);
    expect(api.putWorkout).not.toHaveBeenCalled();
    expect(getSnapshot().active?.sync).toBe("pending");
  });
});
