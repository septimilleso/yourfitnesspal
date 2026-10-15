import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError } from "../api/client";
import type { Exercise, Template, Workout, WorkoutPutBody } from "../api/gym";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "./connectivity";
import { clearGymStore, dispatch, getSnapshot, startWorkoutFromTemplate } from "./gymStore";
import { startGymSync, syncNow } from "./gymSync";
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
const MINUTE_MS = 60_000;
const SETTLE_MS = 1000;
const SERVER_NOW = "2026-10-14T10:00:00.000Z";

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

// Risposta del server costruita dal corpo ricevuto: stesso uuid, ids nuovi, versione base + 1.
function serverCopy(uuid: string, body: WorkoutPutBody): Workout {
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
  };
}

function accepted(sent: string, body: WorkoutPutBody): Promise<Workout> {
  return Promise.resolve(serverCopy(sent, body));
}

function lastBody(): WorkoutPutBody {
  const call = api.putWorkout.mock.calls.at(-1);
  if (call === undefined) throw new Error("nessun PUT inviato");
  return call[1] as WorkoutPutBody;
}

function startedFromTemplate(): string {
  const outcome = startWorkoutFromTemplate(TEMPLATE);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.state.uuid;
}

// Completa una serie e finisce: il finito resta nello store finché non è sincronizzato.
function finishedLocally(): string {
  const uuid = startedFromTemplate();
  const setUuid = getSnapshot().active?.workout.exercises[0].sets[0].uuid ?? "";
  expect(dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } }).ok).toBe(true);
  expect(dispatch(uuid, { type: "finish", discardIncomplete: false }).ok).toBe(true);
  return uuid;
}

// Simula un cambio di visibilità della pagina (l'app torna in primo piano o va in secondo piano).
function fireVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
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
  // Nessun allenamento attivo sul server (204): l'adozione all'apertura non cambia nulla.
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

describe("coalescing delle modifiche (R15, C25)", () => {
  it("cinque modifiche in 500 ms producono un solo PUT, alla scadenza di 1 s di quiete", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockImplementation(accepted);
    stop = startGymSync(queryClient);
    // All'apertura parte il primo invio dell'allenamento appena creato.
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    api.putWorkout.mockClear();

    for (const name of ["Uno", "Due", "Tre", "Quattro", "Cinque"]) {
      expect(dispatch(uuid, { type: "rename", name }).ok).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
    }
    // L'ultima modifica è a 400 ms: la quiete scade a 1400 ms, quindi a 500 ms ancora nessun invio.
    expect(api.putWorkout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 101);
    expect(api.putWorkout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    expect(lastBody()).toMatchObject({ name: "Cinque" });
  });
});

describe("rete e primo piano (R15, C24)", () => {
  it("C24: rete assente durante le modifiche, al ritorno parte un solo PUT con l'ultimo stato", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new NetworkError("network"));
    stop = startGymSync(queryClient);
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    expect(getSnapshot().active?.sync).toBe("pending");

    reportNetworkFailure();
    expect(dispatch(uuid, { type: "rename", name: "Gambe" }).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(dispatch(uuid, { type: "rename", name: "Gambe 2" }).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);

    api.putWorkout.mockImplementation(accepted);
    reportNetworkSuccess();
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(2);
    expect(lastBody()).toMatchObject({ name: "Gambe 2", base_version: null });
    expect(getSnapshot().active).toMatchObject({ sync: "synced", baseVersion: 1 });
  });

  it("C24 a livello di scheduler: una modifica durante il volo parte come secondo PUT con la nuova base_version", async () => {
    startedFromTemplate();
    let resolveFirst: (value: Workout) => void = () => undefined;
    api.putWorkout.mockImplementationOnce(
      () =>
        new Promise<Workout>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    stop = startGymSync(queryClient);
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    const uuid = getSnapshot().active?.workout.uuid ?? "";

    expect(dispatch(uuid, { type: "rename", name: "Durante il volo" }).ok).toBe(true);
    api.putWorkout.mockImplementation(accepted);
    resolveFirst(serverCopy(uuid, lastBody()));
    await settle();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(api.putWorkout).toHaveBeenCalledTimes(2);
    expect(lastBody()).toMatchObject({ base_version: 1, name: "Durante il volo" });
    expect(getSnapshot().active).toMatchObject({ sync: "synced", baseVersion: 2 });
  });

  it("un 5xx su una voce non blocca le successive, compreso l'attivo", async () => {
    const first = finishedLocally();
    vi.setSystemTime(NOW + MINUTE_MS);
    const second = finishedLocally();
    const active = startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new ApiError(503, "Service Unavailable", null));
    api.putWorkout.mockImplementation(accepted);

    stop = startGymSync(queryClient);
    await settle();

    expect(api.putWorkout.mock.calls.map(([uuid]) => uuid)).toEqual([first, second, active]);
    expect(getSnapshot().finished.map((entry) => entry.workout.uuid)).toEqual([first]);
    expect(getSnapshot().finished[0].sync).toBe("pending");
    expect(getSnapshot().active?.sync).toBe("synced");
  });

  it("al ritorno in primo piano riprova una voce in errore di sincronizzazione (R16)", async () => {
    startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new ApiError(400, "Invalid", { detail: "Invalid" }));
    stop = startGymSync(queryClient);
    await settle();
    expect(getSnapshot().active?.sync).toBe("error");

    api.putWorkout.mockClear();
    api.putWorkout.mockImplementation(accepted);
    // Né il tempo, né la rete ritrovata, né una modifica sola la ritentano: solo il primo piano.
    await vi.advanceTimersByTimeAsync(10 * MINUTE_MS);
    reportNetworkFailure();
    reportNetworkSuccess();
    await settle();
    expect(api.putWorkout).not.toHaveBeenCalled();

    fireVisibility("visible");
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    expect(getSnapshot().active?.sync).toBe("synced");
  });

  it("un conflitto non si reinvia da nessun trigger (R18)", async () => {
    startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new ApiError(409, "version_conflict", { detail: "version_conflict", current: null }));
    stop = startGymSync(queryClient);
    await settle();
    expect(getSnapshot().active?.sync).toBe("conflict");

    api.putWorkout.mockClear();
    reportNetworkFailure();
    reportNetworkSuccess();
    fireVisibility("visible");
    await settle();
    expect(api.putWorkout).not.toHaveBeenCalled();
  });

  it("una risposta 2xx senza version finisce come errore e non lascia promise rifiutate (R16)", async () => {
    startedFromTemplate();
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) =>
      Object.assign(serverCopy(sent, body), { version: undefined }),
    );
    stop = startGymSync(queryClient);
    await settle();

    expect(getSnapshot().active?.sync).toBe("error");
  });
});

describe("ordine e token", () => {
  it("prima i finiti in ordine di fine, poi l'attivo", async () => {
    const first = finishedLocally();
    vi.setSystemTime(NOW + MINUTE_MS);
    const second = finishedLocally();
    const active = startedFromTemplate();
    api.putWorkout.mockImplementation(accepted);

    stop = startGymSync(queryClient);
    await settle();

    expect(api.putWorkout.mock.calls.map(([uuid]) => uuid)).toEqual([first, second, active]);
  });

  it("senza token non invia, e all'apertura con token parte il primo invio", async () => {
    await clearToken();
    startedFromTemplate();
    api.putWorkout.mockImplementation(accepted);
    stop = startGymSync(queryClient);
    await settle();
    expect(api.putWorkout).not.toHaveBeenCalled();

    await setToken("tok-a");
    fireVisibility("visible");
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
  });

  it("stop ferma i trigger: né la rete né il primo piano né le modifiche inviano più nulla", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new NetworkError("network"));
    stop = startGymSync(queryClient);
    await settle();
    stop();
    stop = undefined;
    api.putWorkout.mockClear();
    api.putWorkout.mockImplementation(accepted);

    expect(dispatch(uuid, { type: "rename", name: "Dopo lo stop" }).ok).toBe(true);
    reportNetworkFailure();
    reportNetworkSuccess();
    fireVisibility("visible");
    await vi.advanceTimersByTimeAsync(10 * SETTLE_MS);
    await settle();
    expect(api.putWorkout).not.toHaveBeenCalled();
  });
});

describe("syncNow (Termina, R19)", () => {
  it("restituisce l'esito del PUT", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockImplementation(accepted);
    stop = startGymSync(queryClient);

    await expect(syncNow(uuid, 5000)).resolves.toBe("synced");
  });

  it("restituisce timeout se il PUT non risponde entro il tempo, e il PUT prosegue", async () => {
    const uuid = startedFromTemplate();
    let resolveFirst: (value: Workout) => void = () => undefined;
    api.putWorkout.mockImplementationOnce(
      () =>
        new Promise<Workout>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    stop = startGymSync(queryClient);

    const result = syncNow(uuid, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toBe("timeout");

    resolveFirst(serverCopy(uuid, lastBody()));
    await settle();
    expect(getSnapshot().active?.sync).toBe("synced");
  });

  it("con un PUT in volo e poi la fine, sincronizza lo stato finito con un secondo PUT e risponde synced", async () => {
    const uuid = startedFromTemplate();
    const setUuid = getSnapshot().active?.workout.exercises[0].sets[0].uuid ?? "";
    expect(dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } }).ok).toBe(true);
    let resolveFirst: (value: Workout) => void = () => undefined;
    api.putWorkout.mockImplementationOnce(
      () =>
        new Promise<Workout>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    stop = startGymSync(queryClient);
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);

    expect(dispatch(uuid, { type: "finish", discardIncomplete: false }).ok).toBe(true);
    const result = syncNow(uuid, 5000);
    api.putWorkout.mockImplementation(accepted);
    resolveFirst(serverCopy(uuid, lastBody()));

    await expect(result).resolves.toBe("synced");
    expect(api.putWorkout).toHaveBeenCalledTimes(2);
    expect(lastBody()).toMatchObject({ status: "finished" });
    expect(getSnapshot().finished).toHaveLength(0);
  });

  it("un 5xx durante syncNow restituisce pending senza ripetere il PUT", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new ApiError(503, "Service Unavailable", null));
    stop = startGymSync(queryClient);
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);

    api.putWorkout.mockClear();
    api.putWorkout.mockRejectedValueOnce(new ApiError(503, "Service Unavailable", null));
    await expect(syncNow(uuid, 5000)).resolves.toBe("pending");
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
  });

  it("non invia un allenamento in conflitto", async () => {
    const uuid = startedFromTemplate();
    api.putWorkout.mockRejectedValueOnce(new ApiError(409, "version_conflict", { detail: "version_conflict", current: null }));
    stop = startGymSync(queryClient);
    await settle();

    await expect(syncNow(uuid, 5000)).resolves.toBe("conflict");
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
  });

  it("con un PUT già in volo per lo stesso uuid non ne parte un secondo", async () => {
    const uuid = startedFromTemplate();
    let resolveFirst: (value: Workout) => void = () => undefined;
    api.putWorkout.mockImplementationOnce(
      () =>
        new Promise<Workout>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    stop = startGymSync(queryClient);
    await settle();
    expect(api.putWorkout).toHaveBeenCalledTimes(1);

    const second = syncNow(uuid, 5000);
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
    resolveFirst(serverCopy(uuid, lastBody()));
    await expect(second).resolves.toBe("synced");
    expect(api.putWorkout).toHaveBeenCalledTimes(1);
  });
});
