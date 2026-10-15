import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise, Template, Workout } from "../api/gym";
import type { StartOutcome } from "./gymStore";

const fs = vi.hoisted(() => {
  const files = new Map<string, string>();
  const missing = (path: string) => new Error(`File does not exist: ${path}`);
  const state = { inFlight: 0, maxInFlight: 0, renameFailures: 0, gate: null as Promise<void> | null };
  return {
    files,
    state,
    Filesystem: {
      writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
        state.inFlight += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        // Un test può bloccare la scrittura in corso per osservare cosa succede nel frattempo.
        if (state.gate) await state.gate;
        // Due giri di microtask: basta perché due scritture si sovrappongano se la coda non le separa.
        await Promise.resolve();
        await Promise.resolve();
        files.set(path, data);
        state.inFlight -= 1;
      }),
      readFile: vi.fn(async ({ path }: { path: string }) => {
        const data = files.get(path);
        if (data === undefined) throw missing(path);
        return { data };
      }),
      stat: vi.fn(async ({ path }: { path: string }) => {
        if (!files.has(path)) throw missing(path);
        return { type: "file", size: files.get(path)?.length ?? 0, mtime: 0, ctime: 0, uri: path };
      }),
      deleteFile: vi.fn(async ({ path }: { path: string }) => {
        if (!files.has(path)) throw missing(path);
        files.delete(path);
      }),
      rename: vi.fn(async ({ from, to }: { from: string; to: string }) => {
        if (state.renameFailures > 0) {
          state.renameFailures -= 1;
          throw new Error("destinazione esistente");
        }
        const data = files.get(from);
        if (data === undefined) throw missing(from);
        files.delete(from);
        files.set(to, data);
      }),
    },
  };
});
const platform = vi.hoisted(() => ({ native: true }));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: fs.Filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("./platform", () => ({ isNative: () => platform.native }));

const STORE_PATH = "yfp/gym-local.json";
const TMP_PATH = "yfp/gym-local.tmp.json";
const CORRUPT = /^yfp\/gym-local\.corrupt-\d+\.json$/;

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

// Il modulo si ricarica a ogni test: lo stato in memoria non passa da un test all'altro.
type Store = typeof import("./gymStore");
const loadedModules: Store[] = [];

async function loadModule(): Promise<Store> {
  vi.resetModules();
  const store = await import("./gymStore");
  loadedModules.push(store);
  return store;
}

function started(outcome: StartOutcome) {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.state;
}

function setVisibility(value: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
}

function writtenStore(): { schema: number; active: unknown; userId: unknown } {
  const text = fs.files.get(STORE_PATH);
  if (text === undefined) throw new Error("file locale assente");
  return JSON.parse(text);
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.files.clear();
  fs.state.inFlight = 0;
  fs.state.maxInFlight = 0;
  fs.state.renameFailures = 0;
  fs.state.gate = null;
  platform.native = true;
});

afterEach(async () => {
  // Ogni modulo caricato resta vivo con timer e listener di visibilità: azzerarli evita scritture nei test successivi.
  for (const store of loadedModules.splice(0)) {
    await store.clearGymStore();
    await store.flushGymStoreForTests();
  }
  delete (document as unknown as { visibilityState?: string }).visibilityState;
  vi.useRealTimers();
});

describe("gymStore nel browser", () => {
  it("non legge, non scrive e non cancella il file", async () => {
    platform.native = false;
    vi.useFakeTimers();
    const store = await loadModule();

    await store.loadGymStore();
    store.startEmptyWorkout();
    vi.advanceTimersByTime(5000);
    await store.flushGymStore();
    await store.clearGymStore();

    expect(fs.Filesystem.readFile).not.toHaveBeenCalled();
    expect(fs.Filesystem.writeFile).not.toHaveBeenCalled();
    expect(fs.Filesystem.deleteFile).not.toHaveBeenCalled();
    expect(fs.Filesystem.rename).not.toHaveBeenCalled();
  });
});

describe("avvio e azioni", () => {
  it("startEmptyWorkout crea l'allenamento attivo e rifiuta un secondo avvio", async () => {
    const store = await loadModule();

    const first = store.startEmptyWorkout();
    const second = store.startEmptyWorkout();

    expect(first.ok).toBe(true);
    const active = store.getSnapshot().active;
    expect(active?.workout.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(active?.workout.name).toMatch(/^Allenamento \d{2}\/\d{2}\/\d{4}$/);
    expect(active).toMatchObject({ baseVersion: null, revision: 1, sentRevision: 0, sync: "pending", conflict: null, lastServer: null });
    expect(second).toEqual({ ok: false, error: "Hai già un allenamento in corso" });
  });

  it("startWorkoutFromTemplate copia esercizi, serie e riposo dal modello", async () => {
    const store = await loadModule();

    const started = store.startWorkoutFromTemplate(TEMPLATE);

    expect(started.ok).toBe(true);
    const workout = store.getSnapshot().active?.workout;
    expect(workout?.name).toBe("Giorno A");
    expect(workout?.template_id).toBe(3);
    expect(workout?.exercises[0]).toMatchObject({ exercise_id: 1, rest_seconds: 120, note: "nota del modello" });
    expect(workout?.exercises[0].sets).toHaveLength(1);
    expect(workout?.exercises[0].sets[0]).toMatchObject({ weight_kg: 50, reps: 8, completed_at: null });
  });

  it("dispatch applica l'azione, incrementa la revisione e segna da inviare", async () => {
    const store = await loadModule();
    const uuid = started(store.startEmptyWorkout()).uuid;
    const before = store.getSnapshot().active?.revision ?? 0;

    const result = store.dispatch(uuid, { type: "rename", name: "  Gambe  " });

    expect(result.ok).toBe(true);
    const active = store.getSnapshot().active;
    expect(active?.workout.name).toBe("Gambe");
    expect(active?.revision).toBe(before + 1);
    expect(active?.sync).toBe("pending");
  });

  it("un'azione non valida restituisce il messaggio e lascia lo stato invariato", async () => {
    const store = await loadModule();
    const uuid = started(store.startEmptyWorkout()).uuid;
    const before = store.getSnapshot();

    const result = store.dispatch(uuid, { type: "rename", name: "   " });

    expect(result).toEqual({ ok: false, error: "Valori non validi" });
    expect(store.getSnapshot()).toBe(before);
  });

  it("dispatch su un uuid che non è l'attivo non fa nulla", async () => {
    const store = await loadModule();
    store.startEmptyWorkout();
    const before = store.getSnapshot();

    const result = store.dispatch("00000000-0000-4000-8000-000000000000", { type: "rename", name: "X" });

    expect(result).toEqual({ ok: false, error: "Allenamento non attivo" });
    expect(store.getSnapshot()).toBe(before);
  });

  it("un'azione senza effetto non genera una modifica da inviare", async () => {
    const store = await loadModule();
    const uuid = started(store.startEmptyWorkout()).uuid;
    store.dispatch(uuid, {
      type: "addExercises",
      exercises: [{ id: 1, name: "Panca piana", tracking: "weight_reps" }],
      snapshot: null,
    });
    const exerciseUuid = store.getSnapshot().active!.workout.exercises[0].uuid;
    const before = store.getSnapshot();

    const result = store.dispatch(uuid, {
      type: "replaceExercise",
      exerciseUuid,
      exercise: { id: 1, name: "Panca piana", tracking: "weight_reps" },
    });

    expect(result.ok).toBe(true);
    expect(store.getSnapshot()).toBe(before);
  });

  it("un conflitto resta tale dopo una nuova modifica", async () => {
    const store = await loadModule();
    const uuid = started(store.startEmptyWorkout()).uuid;
    store.patchEntry(uuid, { sync: "conflict" });

    store.dispatch(uuid, { type: "rename", name: "Gambe" });

    expect(store.getSnapshot().active?.sync).toBe("conflict");
  });

  it("finire un allenamento lo sposta da active a finished", async () => {
    const store = await loadModule();
    const uuid = started(store.startWorkoutFromTemplate(TEMPLATE)).uuid;
    const setUuid = store.getSnapshot().active!.workout.exercises[0].sets[0].uuid;
    store.dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } });

    const result = store.dispatch(uuid, { type: "finish", discardIncomplete: false });

    expect(result.ok).toBe(true);
    const snapshot = store.getSnapshot();
    expect(snapshot.active).toBeNull();
    expect(snapshot.finished).toHaveLength(1);
    expect(snapshot.finished[0].workout).toMatchObject({ uuid, status: "finished" });
    expect(snapshot.finished[0].sync).toBe("pending");
  });
});

describe("API per il sync", () => {
  it("patchEntry aggiorna il sync e tiene la versione allineata a workout.version", async () => {
    const store = await loadModule();
    const uuid = started(store.startEmptyWorkout()).uuid;
    const server = { id: 9, uuid, version: 3 } as unknown as Workout;

    const patched = store.patchEntry(uuid, { baseVersion: 3, sentRevision: 1, sync: "synced", lastServer: server });

    expect(patched).toBe(true);
    const active = store.getSnapshot().active;
    expect(active).toMatchObject({ baseVersion: 3, sentRevision: 1, sync: "synced", lastServer: server, revision: 1 });
    expect(active?.workout.version).toBe(3);
  });

  it("patchEntry sugli allenamenti finiti e false per un uuid sconosciuto", async () => {
    const store = await loadModule();
    const uuid = started(store.startWorkoutFromTemplate(TEMPLATE)).uuid;
    const setUuid = store.getSnapshot().active!.workout.exercises[0].sets[0].uuid;
    store.dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } });
    store.dispatch(uuid, { type: "finish", discardIncomplete: false });

    expect(store.patchEntry(uuid, { sync: "error" })).toBe(true);
    expect(store.getSnapshot().finished[0].sync).toBe("error");
    expect(store.patchEntry("00000000-0000-4000-8000-000000000000", { sync: "error" })).toBe(false);
  });

  it("removeEntry toglie l'attivo o un finito, false se non c'è", async () => {
    const store = await loadModule();
    const uuid = started(store.startEmptyWorkout()).uuid;

    expect(store.removeEntry(uuid)).toBe(true);
    expect(store.getSnapshot().active).toBeNull();
    expect(store.removeEntry(uuid)).toBe(false);
  });

  it("pendingDeletes: aggiunta con sostituzione per id e rimozione", async () => {
    const store = await loadModule();

    store.addPendingDelete({ id: 5, baseVersion: 1 });
    store.addPendingDelete({ id: 5, baseVersion: 2 });
    store.addPendingDelete({ id: 6, baseVersion: 1 });
    // La sostituzione riaccoda la voce: l'ordine è quello di inserimento dell'ultima versione.
    expect(store.getSnapshot().pendingDeletes).toEqual([
      { id: 5, baseVersion: 2 },
      { id: 6, baseVersion: 1 },
    ]);

    store.removePendingDelete(6);
    store.removePendingDelete(99);
    expect(store.getSnapshot().pendingDeletes).toEqual([{ id: 5, baseVersion: 2 }]);
  });

  it("templateProposals senza duplicati, clockOffsetMs e userId", async () => {
    const store = await loadModule();

    store.setTemplateProposals([3, 3, 4]);
    expect(store.getSnapshot().templateProposals).toEqual([3, 4]);

    store.setClockOffset(60000);
    expect(store.getSnapshot().clockOffsetMs).toBe(60000);

    expect(store.setGymUserId(7)).toBe(false);
    expect(store.getSnapshot().userId).toBe(7);
    expect(store.setGymUserId(7)).toBe(false);
  });

  it("il clockOffsetMs entra nell'orologio delle azioni (R11)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T10:00:00.000Z"));
    const store = await loadModule();
    store.setClockOffset(60000);
    const uuid = started(store.startWorkoutFromTemplate(TEMPLATE)).uuid;
    const setUuid = store.getSnapshot().active!.workout.exercises[0].sets[0].uuid;

    store.dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } });

    // Ora del telefono 10:00 più lo scarto di 60 s: la serie è fatta alle 10:01 del server.
    const completedAt = store.getSnapshot().active?.workout.exercises[0].sets[0].completed_at ?? "";
    expect(Date.parse(completedAt)).toBe(Date.parse("2026-10-14T10:01:00.000Z"));
  });

  it("subscribe è chiamato a ogni modifica e getSnapshot cambia riferimento solo dopo una modifica", async () => {
    const store = await loadModule();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const initial = store.getSnapshot();

    store.removePendingDelete(1);
    expect(store.getSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    store.setTemplateProposals([1]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(initial);

    unsubscribe();
    store.setTemplateProposals([2]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("scrittura su file", () => {
  it("scrive dopo un secondo dall'ultima modifica, in tmp poi con rename", async () => {
    vi.useFakeTimers();
    const store = await loadModule();
    await store.loadGymStore();
    store.setTemplateProposals([1]);

    vi.advanceTimersByTime(999);
    await store.flushGymStoreForTests();
    expect(fs.Filesystem.writeFile).not.toHaveBeenCalled();

    store.setTemplateProposals([2]);
    vi.advanceTimersByTime(999);
    await store.flushGymStoreForTests();
    expect(fs.Filesystem.writeFile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await store.flushGymStoreForTests();

    expect(fs.Filesystem.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.Filesystem.writeFile.mock.calls[0][0]).toMatchObject({ path: TMP_PATH, directory: "LIBRARY" });
    expect(fs.Filesystem.rename.mock.calls[0][0]).toMatchObject({ from: TMP_PATH, to: STORE_PATH });
    expect(writtenStore()).toMatchObject({ schema: 1, userId: null });
    expect(fs.files.has(TMP_PATH)).toBe(false);
  });

  it("il file non contiene il token né altre credenziali", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    store.startWorkoutFromTemplate(TEMPLATE);

    await store.flushGymStore();

    expect(fs.files.get(STORE_PATH)).not.toMatch(/token/i);
  });

  it("non scrive mai il file principale direttamente e non sovrappone due scritture", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    // La prima scrittura resta bloccata: una modifica nel frattempo non deve avviarne un'altra.
    let release!: () => void;
    fs.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.setTemplateProposals([1]);
    const first = store.flushGymStore();
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.setTemplateProposals([2]);
    const second = store.flushGymStore();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fs.Filesystem.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.state.inFlight).toBe(1);
    release();
    fs.state.gate = null;
    await Promise.all([first, second]);

    const paths = fs.Filesystem.writeFile.mock.calls.map((call) => call[0].path);
    expect(paths).not.toContain(STORE_PATH);
    expect(fs.Filesystem.writeFile).toHaveBeenCalledTimes(2);
    expect(fs.state.maxInFlight).toBe(1);
    expect(writtenStore()).toMatchObject({ templateProposals: [2] });
  });

  it("flush immediato quando l'app va in background", async () => {
    vi.useFakeTimers();
    const store = await loadModule();
    await store.loadGymStore();
    store.setTemplateProposals([4]);

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await store.flushGymStoreForTests();

    expect(fs.Filesystem.rename).toHaveBeenCalledTimes(1);
    expect(writtenStore()).toMatchObject({ templateProposals: [4] });
  });

  it("il passaggio a visibile non scrive", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    store.setTemplateProposals([4]);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await store.flushGymStoreForTests();

    expect(fs.Filesystem.writeFile).not.toHaveBeenCalled();
  });

  it("se la scrittura fallisce la modifica resta da salvare e la prossima scrittura la prende", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    fs.Filesystem.writeFile.mockRejectedValueOnce(new Error("disco pieno"));
    store.setTemplateProposals([8]);

    await store.flushGymStore();
    expect(fs.files.has(STORE_PATH)).toBe(false);

    await store.flushGymStore();
    expect(writtenStore()).toMatchObject({ templateProposals: [8] });
  });

  it("se il rename non sostituisce il file esistente lo cancella dopo aver verificato il temporaneo", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    store.setTemplateProposals([1]);
    await store.flushGymStore();
    store.setTemplateProposals([2]);
    fs.state.renameFailures = 1;

    await store.flushGymStore();

    expect(fs.Filesystem.stat).toHaveBeenCalledWith({ path: TMP_PATH, directory: "LIBRARY" });
    expect(fs.Filesystem.deleteFile).toHaveBeenCalledWith({ path: STORE_PATH, directory: "LIBRARY" });
    expect(writtenStore()).toMatchObject({ templateProposals: [2] });
    expect(fs.files.has(TMP_PATH)).toBe(false);
  });
});

describe("caricamento all'avvio", () => {
  it("un file assente lascia lo store vuoto senza rinominare nulla", async () => {
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot()).toMatchObject({ schema: 1, active: null, finished: [] });
    expect(fs.Filesystem.rename).not.toHaveBeenCalled();
  });

  it("un JSON non valido viene rinominato in yfp/gym-local.corrupt-<ms>.json e lo store parte vuoto", async () => {
    fs.files.set(STORE_PATH, "{ non è json");
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot()).toMatchObject({ active: null, finished: [] });
    const moved = fs.Filesystem.rename.mock.calls[0][0];
    expect(moved.from).toBe(STORE_PATH);
    expect(moved.to).toMatch(CORRUPT);
    expect(fs.files.has(STORE_PATH)).toBe(false);
    expect(fs.files.get(moved.to)).toBe("{ non è json");
    expect(fs.Filesystem.deleteFile).not.toHaveBeenCalled();
  });

  it("uno schema sconosciuto viene trattato come corrotto", async () => {
    fs.files.set(STORE_PATH, JSON.stringify({ schema: 2, userId: null }));
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot().active).toBeNull();
    expect(fs.Filesystem.rename.mock.calls[0][0].to).toMatch(CORRUPT);
  });

  it("un file esistente che non si legge viene rinominato come corrotto", async () => {
    fs.files.set(STORE_PATH, "dati");
    fs.Filesystem.readFile.mockRejectedValueOnce(new Error("permesso negato"));
    const store = await loadModule();

    await store.loadGymStore();

    expect(fs.Filesystem.rename.mock.calls[0][0].to).toMatch(CORRUPT);
    expect(store.getSnapshot().active).toBeNull();
  });

  it("un temporaneo completo senza file principale viene recuperato e riscritto", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    store.startWorkoutFromTemplate(TEMPLATE);
    await store.flushGymStore();
    const saved = store.getSnapshot();
    fs.files.set(TMP_PATH, fs.files.get(STORE_PATH)!);
    fs.files.delete(STORE_PATH);

    const recovered = await loadModule();
    await recovered.loadGymStore();

    expect(recovered.getSnapshot()).toEqual(saved);
    await recovered.flushGymStore();
    expect(fs.files.has(STORE_PATH)).toBe(true);
    expect(fs.files.has(TMP_PATH)).toBe(false);
  });

  it("riavvio simulato: il load dopo il save restituisce lo stesso stato", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    const uuid = started(store.startWorkoutFromTemplate(TEMPLATE)).uuid;
    const setUuid = store.getSnapshot().active!.workout.exercises[0].sets[0].uuid;
    store.dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 52.5, reps: 6, duration_s: null } });
    store.addPendingDelete({ id: 12, baseVersion: 4 });
    store.setTemplateProposals([3]);
    store.setClockOffset(-1500);
    await store.flushGymStore();
    const saved = store.getSnapshot();

    const restarted = await loadModule();
    await restarted.loadGymStore();

    expect(restarted.getSnapshot()).toEqual(saved);
    expect(restarted.getSnapshot().active?.workout.exercises[0].sets[0]).toMatchObject({
      weight_kg: 52.5,
      completed_at: expect.any(String),
    });
  });
});

describe("cancellazione", () => {
  it("clearGymStore svuota memoria e file, e il flush successivo non ricrea il file", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    store.startWorkoutFromTemplate(TEMPLATE);
    await store.flushGymStore();
    expect(fs.files.has(STORE_PATH)).toBe(true);

    await store.clearGymStore();
    await store.flushGymStore();

    expect(store.getSnapshot()).toMatchObject({ active: null, finished: [], pendingDeletes: [], userId: null });
    expect(fs.files.has(STORE_PATH)).toBe(false);
    expect(fs.Filesystem.writeFile).toHaveBeenCalledTimes(1);
  });

  it("clearGymStore annulla la scrittura programmata", async () => {
    vi.useFakeTimers();
    const store = await loadModule();
    await store.loadGymStore();
    store.setTemplateProposals([1]);

    await store.clearGymStore();
    vi.advanceTimersByTime(5000);
    await store.flushGymStoreForTests();

    expect(fs.Filesystem.writeFile).not.toHaveBeenCalled();
    expect(fs.files.has(STORE_PATH)).toBe(false);
  });

  it("setGymUserId con un utente diverso cancella il file precedente senza inviarlo", async () => {
    const store = await loadModule();
    await store.loadGymStore();
    store.setGymUserId(7);
    store.startWorkoutFromTemplate(TEMPLATE);
    await store.flushGymStore();

    const switched = store.setGymUserId(8);
    await store.flushGymStoreForTests();

    expect(switched).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ userId: 8, active: null });
    expect(fs.files.has(STORE_PATH)).toBe(false);
  });

  it("la cancellazione elimina prima il temporaneo, poi il principale", async () => {
    const store = await loadModule();
    fs.files.set(STORE_PATH, storeJson([1]));
    fs.files.set(TMP_PATH, storeJson([2]));

    await store.clearGymStore();

    expect(fs.Filesystem.deleteFile.mock.calls.map((call) => call[0].path)).toEqual([TMP_PATH, STORE_PATH]);
    expect(fs.files.size).toBe(0);
  });
});

describe("recupero tra temporaneo e principale", () => {
  it("un temporaneo valido più recente del principale vince e viene scritto nel file vero", async () => {
    fs.files.set(STORE_PATH, storeJson([1]));
    fs.files.set(TMP_PATH, storeJson([2]));
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot().templateProposals).toEqual([2]);
    await store.flushGymStore();
    expect(writtenStore()).toMatchObject({ templateProposals: [2] });
    expect(fs.files.has(TMP_PATH)).toBe(false);
    expect(fs.Filesystem.rename.mock.calls.some((call) => CORRUPT.test(call[0].to))).toBe(false);
  });

  it("un temporaneo troncato non vince: si carica il principale e il temporaneo resta com'è", async () => {
    fs.files.set(STORE_PATH, storeJson([1]));
    fs.files.set(TMP_PATH, '{"schema":1,"userId":nu');
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot().templateProposals).toEqual([1]);
    expect(fs.Filesystem.rename).not.toHaveBeenCalled();
    expect(fs.files.get(TMP_PATH)).toBe('{"schema":1,"userId":nu');
  });

  it("un temporaneo non valido senza principale viene messo da parte", async () => {
    fs.files.set(TMP_PATH, '{"schema":1,"us');
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot().active).toBeNull();
    expect(fs.Filesystem.rename.mock.calls[0][0]).toMatchObject({ from: TMP_PATH });
    expect(fs.Filesystem.rename.mock.calls[0][0].to).toMatch(CORRUPT);
  });
});

describe("validazione della forma dell'allenamento attivo", () => {
  it.each([
    ["un esercizio null", [null]],
    ["sets che non è un array", [{ uuid: "e1", sets: "x" }]],
    ["una serie null", [{ uuid: "e1", sets: [null] }]],
  ])("con %s il file viene messo da parte come corrotto", async (_label, exercises) => {
    fs.files.set(STORE_PATH, storeWithActive(exercises));
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot().active).toBeNull();
    expect(fs.Filesystem.rename.mock.calls[0][0].to).toMatch(CORRUPT);
  });

  it("un allenamento con esercizi e serie ben formati si carica", async () => {
    fs.files.set(STORE_PATH, storeWithActive([{ uuid: "e1", sets: [{ uuid: "s1" }] }]));
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot().active?.workout.exercises[0].sets[0].uuid).toBe("s1");
    expect(fs.Filesystem.rename).not.toHaveBeenCalled();
  });
});

describe("proposta Aggiorna modello (R19)", () => {
  it("markTemplateProposal segna solo un finito locale, una volta sola", async () => {
    fs.files.set(STORE_PATH, storeWithFinished({}));
    const store = await loadModule();
    await store.loadGymStore();

    expect(store.markTemplateProposal("f1")).toBe(true);
    expect(store.getSnapshot().finished[0].templateProposal).toBe(true);
    expect(store.markTemplateProposal("f1")).toBe(false);
    expect(store.markTemplateProposal("non-esiste")).toBe(false);
  });

  it("markTemplateProposal non segna l'allenamento attivo", async () => {
    fs.files.set(STORE_PATH, storeWithActive([{ uuid: "e1", sets: [{ uuid: "s1" }] }]));
    const store = await loadModule();
    await store.loadGymStore();

    expect(store.markTemplateProposal("w1")).toBe(false);
    expect(store.getSnapshot().active?.templateProposal).toBeUndefined();
  });

  it("removeTemplateProposal toglie solo l'id indicato", async () => {
    const store = await loadModule();
    store.setTemplateProposals([1, 2]);

    store.removeTemplateProposal(1);
    store.removeTemplateProposal(99);

    expect(store.getSnapshot().templateProposals).toEqual([2]);
  });

  it("il segno sopravvive al riavvio, e un file senza il campo resta valido", async () => {
    fs.files.set(STORE_PATH, storeWithFinished({ templateProposal: true }));
    const store = await loadModule();
    await store.loadGymStore();

    expect(store.getSnapshot().finished[0].templateProposal).toBe(true);
    expect(fs.Filesystem.rename).not.toHaveBeenCalled();
  });

  it("un campo templateProposal che non è un booleano rende il file corrotto", async () => {
    fs.files.set(STORE_PATH, storeWithFinished({ templateProposal: "sì" }));
    const store = await loadModule();

    await store.loadGymStore();

    expect(store.getSnapshot().finished).toHaveLength(0);
    expect(fs.Filesystem.rename.mock.calls[0][0].to).toMatch(CORRUPT);
  });
});

describe("scrittura prima del caricamento", () => {
  it("una modifica prima di loadGymStore non scrive e non tocca il file esistente", async () => {
    vi.useFakeTimers();
    fs.files.set(STORE_PATH, storeJson([5]));
    const store = await loadModule();

    store.setTemplateProposals([9]);
    await store.flushGymStore();
    vi.advanceTimersByTime(5000);
    await store.flushGymStoreForTests();

    expect(fs.Filesystem.writeFile).not.toHaveBeenCalled();
    expect(fs.files.get(STORE_PATH)).toBe(storeJson([5]));

    await store.loadGymStore();
    expect(store.getSnapshot().templateProposals).toEqual([5]);
    expect(fs.Filesystem.writeFile).not.toHaveBeenCalled();
  });
});

describe("ripetizione dopo un errore di scrittura", () => {
  it("con errori ripetuti l'attesa raddoppia fino a 30 s e azzera al successo", async () => {
    vi.useFakeTimers();
    const store = await loadModule();
    await store.loadGymStore();
    for (let i = 0; i < 6; i += 1) fs.Filesystem.writeFile.mockRejectedValueOnce(new Error("disco pieno"));
    store.setTemplateProposals([1]);
    // Primo tentativo dopo il ritardo ordinario, poi 1, 2, 4, 8, 16 e 30 s (tetto).
    const gaps = [1000, 1000, 2000, 4000, 8000, 16000, 30000];

    for (const [i, gap] of gaps.entries()) {
      vi.advanceTimersByTime(gap - 1);
      await store.flushGymStoreForTests();
      expect(fs.Filesystem.writeFile).toHaveBeenCalledTimes(i);
      vi.advanceTimersByTime(1);
      await store.flushGymStoreForTests();
      expect(fs.Filesystem.writeFile).toHaveBeenCalledTimes(i + 1);
    }

    expect(writtenStore()).toMatchObject({ templateProposals: [1] });
    // Dopo il successo nessun altro tentativo parte da solo.
    vi.advanceTimersByTime(60000);
    await store.flushGymStoreForTests();
    expect(fs.Filesystem.writeFile).toHaveBeenCalledTimes(gaps.length);
  });
});

function storeJson(templateProposals: number[]): string {
  return JSON.stringify({
    schema: 1,
    userId: null,
    clockOffsetMs: 0,
    active: null,
    finished: [],
    pendingDeletes: [],
    templateProposals,
  });
}

function storeWithFinished(extra: Record<string, unknown>): string {
  return JSON.stringify({
    schema: 1,
    userId: null,
    clockOffsetMs: 0,
    active: null,
    finished: [
      {
        workout: { uuid: "f1", exercises: [] },
        baseVersion: 2,
        revision: 1,
        sentRevision: 1,
        sync: "pending",
        conflict: null,
        lastServer: null,
        ...extra,
      },
    ],
    pendingDeletes: [],
    templateProposals: [],
  });
}

function storeWithActive(exercises: unknown): string {
  return JSON.stringify({
    schema: 1,
    userId: null,
    clockOffsetMs: 0,
    active: {
      workout: { uuid: "w1", exercises },
      baseVersion: null,
      revision: 1,
      sentRevision: 0,
      sync: "pending",
      conflict: null,
      lastServer: null,
    },
    finished: [],
    pendingDeletes: [],
    templateProposals: [],
  });
}
