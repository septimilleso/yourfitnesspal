import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import type { Exercise, Template, Workout, WorkoutPutBody } from "../api/gym";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "./connectivity";
import { clearGymStore, dispatch, getSnapshot, setTemplateProposals, startWorkoutFromTemplate } from "./gymStore";
import { cancelLocal, resolveConflict, startGymSync, syncEntry } from "./gymSync";
import { clearToken, setToken } from "./session";

const platform = vi.hoisted(() => ({ native: true }));
const api = vi.hoisted(() => ({ fetchActiveWorkout: vi.fn(), putWorkout: vi.fn(), deleteWorkoutChecked: vi.fn() }));
const preferences = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
}));

// Il token e le scritture sul file esistono solo nell'IPA: il test finge la piattaforma nativa, con i file in memoria.
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
  deleteWorkoutChecked: api.deleteWorkoutChecked,
}));

const NOW = Date.parse("2026-10-14T10:00:00.000Z");
const SETTLE_MS = 1000;
const SERVER_NOW = "2026-10-14T10:00:00.000Z";
const OTHER_UUID = "0a0b0c0d-0000-4000-8000-000000000007";

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

// Copia del server costruita dal corpo ricevuto: id 42, versione base + 1.
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

// Allenamento del server senza esercizi: basta per le copie che la scelta del conflitto prende come `current`.
function remoteWorkout(overrides: Partial<Workout>): Workout {
  return {
    id: 7,
    uuid: OTHER_UUID,
    version: 2,
    name: "Altro",
    template_id: null,
    status: "in_progress",
    started_at: SERVER_NOW,
    finished_at: null,
    rest_ends_at: null,
    rest_total_s: null,
    server_now: SERVER_NOW,
    template_diff: [],
    exercises: [],
    ...overrides,
  };
}

function conflictError(reason: string, current: Workout | null): ApiError {
  return new ApiError(409, reason, { detail: reason, current });
}

function startedFromTemplate(): string {
  const outcome = startWorkoutFromTemplate(TEMPLATE);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.state.uuid;
}

// Allenamento già sincronizzato: id 42, versione 1.
async function synced(): Promise<string> {
  const uuid = startedFromTemplate();
  api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));
  expect(await syncEntry(uuid, queryClient)).toBe("synced");
  return uuid;
}

// Porta l'allenamento in conflitto con un 409 del PUT.
async function inConflict(uuid: string, reason: string, current: Workout | null): Promise<void> {
  api.putWorkout.mockRejectedValueOnce(conflictError(reason, current));
  expect(await syncEntry(uuid, queryClient)).toBe("conflict");
}

// Lascia girare le promise e i timer a zero ritardo finché il giro non si ferma.
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
}

// Simula il ritorno in primo piano dell'app (visibilitychange) con lo stato dato.
function fireVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

// Avvia il sync prima di creare dati: l'adozione iniziale vede lo store vuoto e non tocca nulla.
async function started(): Promise<void> {
  stop = startGymSync(queryClient);
  await settle();
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
  api.fetchActiveWorkout.mockReset();
  api.fetchActiveWorkout.mockResolvedValue(null);
  api.putWorkout.mockReset();
  api.deleteWorkoutChecked.mockReset();
  api.deleteWorkoutChecked.mockResolvedValue(undefined);
  queryClient = new QueryClient();
  // Nel browser lo store è solo in memoria: il reset lo riporta vuoto.
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

describe("conflitto di versione (R18, C29)", () => {
  it("copia del telefono: il PUT riparte con base_version uguale alla versione del server", async () => {
    await started();
    const uuid = await synced();
    expect(dispatch(uuid, { type: "rename", name: "Locale" }).ok).toBe(true);
    await inConflict(uuid, "version_conflict", remoteWorkout({ id: 42, uuid, version: 5, name: "Web" }));
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));

    expect(await resolveConflict(uuid, "local")).toBe("synced");

    const body = api.putWorkout.mock.calls.at(-1)?.[1] as WorkoutPutBody;
    expect(body.base_version).toBe(5);
    expect(body.name).toBe("Locale");
    expect(getSnapshot().active).toMatchObject({ sync: "synced", conflict: null, baseVersion: 6 });
    expect(api.deleteWorkoutChecked).not.toHaveBeenCalled();
  });

  it("copia del server: lo stato locale prende current e non parte nessun PUT", async () => {
    await started();
    const uuid = await synced();
    await inConflict(uuid, "version_conflict", remoteWorkout({ id: 42, uuid, version: 5, name: "Dal server" }));
    const putsBefore = api.putWorkout.mock.calls.length;

    expect(await resolveConflict(uuid, "server")).toBe("synced");

    expect(api.putWorkout.mock.calls.length).toBe(putsBefore);
    expect(getSnapshot().active).toMatchObject({
      baseVersion: 5,
      sync: "synced",
      conflict: null,
      workout: { id: 42, uuid, name: "Dal server", version: 5 },
    });
  });

  it("copia del server finita: la voce locale si toglie", async () => {
    await started();
    const uuid = await synced();
    await inConflict(uuid, "version_conflict", remoteWorkout({ id: 42, uuid, version: 5, status: "finished", finished_at: SERVER_NOW }));

    expect(await resolveConflict(uuid, "server")).toBe("missing");

    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().finished).toHaveLength(0);
  });

  it("copia del server assente (current null): la voce locale si toglie", async () => {
    await started();
    const uuid = await synced();
    await inConflict(uuid, "version_conflict", null);

    expect(await resolveConflict(uuid, "server")).toBe("missing");

    expect(getSnapshot().active).toBeNull();
  });

  it("copia del telefono con current null: il PUT riparte con base_version null", async () => {
    await started();
    const uuid = await synced();
    await inConflict(uuid, "version_conflict", null);
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));

    expect(await resolveConflict(uuid, "local")).toBe("synced");

    const body = api.putWorkout.mock.calls.at(-1)?.[1] as WorkoutPutBody;
    expect(body.base_version).toBeNull();
  });
});

describe("altro allenamento in corso (R18, C30)", () => {
  it("copia del telefono: prima il DELETE dell'altro senza versione, poi il PUT", async () => {
    await started();
    const uuid = startedFromTemplate();
    await inConflict(uuid, "other_active", remoteWorkout({ id: 7, uuid: OTHER_UUID, version: 2 }));
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));

    expect(await resolveConflict(uuid, "local")).toBe("synced");

    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
    expect(api.deleteWorkoutChecked).toHaveBeenCalledWith(7);
    const deleteOrder = api.deleteWorkoutChecked.mock.invocationCallOrder[0] ?? Infinity;
    const putOrder = api.putWorkout.mock.invocationCallOrder.at(-1) ?? 0;
    expect(deleteOrder).toBeLessThan(putOrder);
    const body = api.putWorkout.mock.calls.at(-1)?.[1] as WorkoutPutBody;
    expect(body.base_version).toBeNull();
  });

  it("copia del server: l'altro allenamento diventa l'attivo e il telefono non invia nulla", async () => {
    await started();
    const uuid = startedFromTemplate();
    await inConflict(uuid, "other_active", remoteWorkout({ id: 7, uuid: OTHER_UUID, version: 2, name: "Altro" }));
    const putsBefore = api.putWorkout.mock.calls.length;

    expect(await resolveConflict(uuid, "server")).toBe("synced");

    expect(api.deleteWorkoutChecked).not.toHaveBeenCalled();
    expect(api.putWorkout.mock.calls.length).toBe(putsBefore);
    expect(getSnapshot().active).toMatchObject({ workout: { id: 7, uuid: OTHER_UUID, name: "Altro" }, sync: "synced" });
  });

  it("altro allenamento già sparito (current null): nessun DELETE, solo il PUT", async () => {
    await started();
    const uuid = startedFromTemplate();
    await inConflict(uuid, "other_active", null);
    api.putWorkout.mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => serverCopy(sent, body));

    expect(await resolveConflict(uuid, "local")).toBe("synced");

    expect(api.deleteWorkoutChecked).not.toHaveBeenCalled();
    expect(api.putWorkout.mock.calls.at(-1)?.[0]).toBe(uuid);
  });

  it("DELETE dell'altro fallito per rete: il conflitto resta e nessun PUT parte", async () => {
    await started();
    const uuid = startedFromTemplate();
    await inConflict(uuid, "other_active", remoteWorkout({ id: 7, uuid: OTHER_UUID, version: 2 }));
    const putsBefore = api.putWorkout.mock.calls.length;
    api.deleteWorkoutChecked.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    expect(await resolveConflict(uuid, "local")).toBe("conflict");

    expect(api.putWorkout.mock.calls.length).toBe(putsBefore);
    expect(getSnapshot().active).toMatchObject({ sync: "conflict" });
  });
});

describe("annullamento (R20, C33, C53)", () => {
  it("C33: un allenamento mai sincronizzato si annulla solo in locale, senza richieste", async () => {
    await started();
    const uuid = startedFromTemplate();

    expect(cancelLocal(uuid)).toBe(true);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await settle();

    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().pendingDeletes).toHaveLength(0);
    expect(api.putWorkout).not.toHaveBeenCalled();
    expect(api.deleteWorkoutChecked).not.toHaveBeenCalled();
  });

  it("C53: offline un allenamento sincronizzato sparisce, al ritorno della rete parte il DELETE con la versione nota", async () => {
    await started();
    const uuid = await synced();
    reportNetworkFailure();

    expect(cancelLocal(uuid)).toBe(true);
    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().pendingDeletes).toEqual([expect.objectContaining({ id: 42, baseVersion: 1 })]);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await settle();
    expect(api.deleteWorkoutChecked).not.toHaveBeenCalled();

    reportNetworkSuccess();
    await settle();

    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
    expect(api.deleteWorkoutChecked).toHaveBeenCalledWith(42, 1);
    expect(getSnapshot().pendingDeletes).toHaveLength(0);
  });

  it("C53: se il server ha un'altra versione il DELETE dà 409 e la copia torna in conflitto, senza altri DELETE", async () => {
    await started();
    const uuid = await synced();
    reportNetworkFailure();
    cancelLocal(uuid);
    const webCopy = remoteWorkout({ id: 42, uuid, version: 2, name: "Modificato sul web" });
    api.deleteWorkoutChecked.mockRejectedValueOnce(conflictError("version_conflict", webCopy));

    reportNetworkSuccess();
    await settle();

    expect(getSnapshot().pendingDeletes).toHaveLength(0);
    expect(getSnapshot().active).toMatchObject({
      sync: "conflict",
      conflict: { reason: "version_conflict", current: webCopy },
      workout: { uuid, id: 42 },
    });
    // Nessun altro DELETE, né ora né ai giri successivi.
    reportNetworkFailure();
    reportNetworkSuccess();
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 3);
    await settle();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
  });

  it("DELETE con 404: l'allenamento è già sparito e l'annullamento si chiude", async () => {
    await started();
    const uuid = await synced();
    reportNetworkFailure();
    cancelLocal(uuid);
    api.deleteWorkoutChecked.mockRejectedValueOnce(new ApiError(404, "not found", null));

    reportNetworkSuccess();
    await settle();

    expect(getSnapshot().pendingDeletes).toHaveLength(0);
    expect(getSnapshot().active).toBeNull();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
  });

  it("annullato durante il PUT in volo (mai sincronizzato): a risposta ricevuta il server viene annullato con l'id ricevuto", async () => {
    await started();
    const uuid = startedFromTemplate();
    let release: () => void = () => undefined;
    api.putWorkout.mockImplementationOnce(
      (sent: string, body: WorkoutPutBody) => new Promise<Workout>((resolve) => (release = () => resolve(serverCopy(sent, body)))),
    );
    // Il primo invio parte allo scadere della quiete: il PUT resta in volo finché non si chiama `release`.
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(api.putWorkout).toHaveBeenCalledTimes(1);

    cancelLocal(uuid);
    expect(getSnapshot().active).toBeNull();
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await settle();

    expect(getSnapshot().pendingDeletes).toHaveLength(0);
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
    expect(api.deleteWorkoutChecked).toHaveBeenCalledWith(42, 1);
  });

  it("annullato durante il PUT in volo (già sincronizzato): il DELETE usa la versione che il PUT ha prodotto", async () => {
    await started();
    const uuid = await synced();
    expect(dispatch(uuid, { type: "rename", name: "Nuovo" }).ok).toBe(true);
    let release: () => void = () => undefined;
    api.putWorkout.mockImplementationOnce(
      (sent: string, body: WorkoutPutBody) => new Promise<Workout>((resolve) => (release = () => resolve(serverCopy(sent, body)))),
    );
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(api.putWorkout).toHaveBeenCalledTimes(2);

    cancelLocal(uuid);
    release();
    await settle();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await settle();

    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
    // Il PUT in volo ha portato la versione da 1 a 2: il DELETE deve usare quella, non la vecchia.
    expect(api.deleteWorkoutChecked).toHaveBeenCalledWith(42, 2);
  });

  it("due giri sovrapposti con il DELETE in volo: un solo DELETE e, anche con due 409, una sola voce in conflitto", async () => {
    await started();
    const uuid = await synced();
    reportNetworkFailure();
    cancelLocal(uuid);
    const webCopy = remoteWorkout({ id: 42, uuid, version: 2, name: "Web" });
    let rejectFirst: () => void = () => undefined;
    api.deleteWorkoutChecked.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (rejectFirst = () => reject(conflictError("version_conflict", webCopy)))),
    );

    // Il primo giro parte alla riconnessione e resta in volo.
    reportNetworkSuccess();
    await settle();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
    // Un secondo giro sovrapposto (una modifica nello store e una nuova riconnessione) non rispedisce lo stesso DELETE.
    setTemplateProposals([9]);
    reportNetworkFailure();
    reportNetworkSuccess();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await settle();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);

    rejectFirst();
    await settle();
    // Anche un giro che arriva dopo il 409 non ripete il DELETE e non duplica la voce in conflitto.
    reportNetworkFailure();
    reportNetworkSuccess();
    await settle();

    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
    expect(getSnapshot().pendingDeletes).toHaveLength(0);
    const copies = [getSnapshot().active, ...getSnapshot().finished].filter((entry) => entry?.workout.uuid === uuid);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ sync: "conflict", conflict: { current: webCopy } });
  });

  it("DELETE con un 4xx diverso da 404/409: l'annullamento è in errore e si ritenta solo al primo piano", async () => {
    await started();
    const uuid = await synced();
    reportNetworkFailure();
    cancelLocal(uuid);
    api.deleteWorkoutChecked.mockRejectedValueOnce(new ApiError(422, "Valori non validi", null));

    reportNetworkSuccess();
    await settle();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);

    // Un altro giro senza primo piano non lo rispedisce, a differenza di un errore di rete.
    setTemplateProposals([9]);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await settle();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
    expect(getSnapshot().pendingDeletes).toEqual([expect.objectContaining({ id: 42 })]);

    // Ritorno in primo piano: il giro ritenta.
    fireVisibility("visible");
    await settle();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(2);
  });
});
