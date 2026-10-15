import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise, Template, Workout, WorkoutPutBody } from "../../api/gym";
import { putWorkout, useApplyToTemplate, useDeleteWorkout, useSaveAsTemplate, useWorkout } from "../../api/gym";
import { syncEntry } from "../../native/gymSync";
import {
  clearGymStore,
  dispatch,
  flushGymStore,
  getSnapshot,
  setTemplateProposals,
  startWorkoutFromTemplate,
} from "../../native/gymStore";
import LocalWorkoutDetailPage from "./LocalWorkoutDetailPage";
import WorkoutDetailPage from "./WorkoutDetailPage";

// Proposta "Aggiorna modello" dopo il sync (R19, C54): nell'IPA compare una volta sola, nel riepilogo o nel dettaglio.

const platform = vi.hoisted(() => ({ native: true }));
// File in memoria: il test rilegge il file locale come lo rileggerebbe un riavvio.
const disk = vi.hoisted(() => {
  const files = new Map<string, string>();
  const missing = (path: string) => new Error(`File does not exist: ${path}`);
  return {
    files,
    Filesystem: {
      writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
        files.set(path, data);
      }),
      readFile: vi.fn(async ({ path }: { path: string }) => {
        const data = files.get(path);
        if (data === undefined) throw missing(path);
        return { data };
      }),
      stat: vi.fn(async ({ path }: { path: string }) => {
        if (!files.has(path)) throw missing(path);
        return { type: "file", size: 0, mtime: 0, ctime: 0, uri: path };
      }),
      deleteFile: vi.fn(async ({ path }: { path: string }) => {
        files.delete(path);
      }),
      rename: vi.fn(async ({ from, to }: { from: string; to: string }) => {
        const data = files.get(from);
        if (data === undefined) throw missing(from);
        files.delete(from);
        files.set(to, data);
      }),
    },
  };
});

const STORE_PATH = "yfp/gym-local.json";

vi.mock("../../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: disk.Filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("../../api/gym", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/gym")>()),
  useWorkout: vi.fn(),
  useApplyToTemplate: vi.fn(),
  useSaveAsTemplate: vi.fn(),
  useDeleteWorkout: vi.fn(),
  putWorkout: vi.fn(),
}));

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

const SERVER_DIFF = ["Panca piana: serie 1 50 kg × 8 → 55 kg × 8"];

const finished: Workout = {
  id: 9,
  uuid: "uuid-9",
  version: 2,
  name: "Giorno 1",
  template_id: 3,
  status: "finished",
  started_at: "2026-10-14T18:00:00Z",
  finished_at: "2026-10-14T19:05:00Z",
  rest_ends_at: null,
  rest_total_s: null,
  server_now: "2026-10-14T19:05:00Z",
  template_diff: SERVER_DIFF,
  exercises: [
    {
      id: 21,
      uuid: "ex-1",
      rest_seconds: 90,
      superset_group: null,
      note: null,
      exercise: PANCA,
      sets: [{ id: 31, uuid: "set-1", weight_kg: 55, reps: 8, duration_s: null, completed_at: "2026-10-14T18:10:00Z", previous: null, max_set: null }],
    },
  ],
};

// Risposta del server a un PUT: stesso uuid, id nuovo, template_diff del server (come in gymSync.test.ts).
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
    server_now: "2026-10-14T19:05:00.000Z",
    template_diff: SERVER_DIFF,
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

const apply = vi.fn();
const saveAs = vi.fn();
const remove = vi.fn();

function mockWorkout(workout: Workout) {
  vi.mocked(useWorkout).mockReturnValue({ data: workout, isLoading: false, isError: false } as unknown as ReturnType<typeof useWorkout>);
}

function renderDetail(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/gym/history/:id" element={<WorkoutDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Riepilogo locale con la rotta del server accanto: il sync a riepilogo aperto porta lì con `replace`.
function renderSummary(uuid: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/gym/history/local/${uuid}?summary=1`]}>
        <Routes>
          <Route path="/gym/history/local/:uuid" element={<LocalWorkoutDetailPage />} />
          <Route path="/gym/history/:id" element={<WorkoutDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Il riquadro compare con il titolo "Modifiche rispetto al modello" e il pulsante "Aggiorna modello".
function expectProposalShown() {
  expect(screen.getByRole("heading", { name: "Modifiche rispetto al modello" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Aggiorna modello" })).toBeInTheDocument();
}

function expectProposalHidden() {
  expect(screen.queryByRole("heading", { name: "Modifiche rispetto al modello" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Aggiorna modello" })).not.toBeInTheDocument();
}

// Avvia dal modello, completa l'unica serie e finisce: il finito resta nello store finché non è sincronizzato.
function finishedLocally(): string {
  const started = startWorkoutFromTemplate(TEMPLATE);
  if (!started.ok) throw new Error(started.error);
  const { uuid } = started.state;
  const setUuid = started.state.exercises[0].sets[0].uuid;
  expect(dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } }).ok).toBe(true);
  expect(dispatch(uuid, { type: "finish", discardIncomplete: false }).ok).toBe(true);
  return uuid;
}

// Il prossimo PUT riceve la risposta del server con il `template_diff`, e il dettaglio la mostra da subito.
function confirmNextPut() {
  vi.mocked(putWorkout).mockImplementationOnce(async (sent: string, body: WorkoutPutBody) => {
    const confirmed = serverCopy(sent, body);
    mockWorkout(confirmed);
    return confirmed;
  });
}

function storedFinished(): Array<{ workout: { uuid: string }; templateProposal?: boolean }> {
  const text = disk.files.get(STORE_PATH);
  if (text === undefined) throw new Error("file locale assente");
  return JSON.parse(text).finished;
}

let queryClient: QueryClient;

beforeEach(async () => {
  platform.native = true;
  apply.mockReset();
  saveAs.mockReset();
  remove.mockReset();
  vi.mocked(putWorkout).mockReset();
  disk.files.clear();
  vi.mocked(useApplyToTemplate).mockReturnValue({ mutate: apply, isPending: false, isSuccess: false } as unknown as ReturnType<typeof useApplyToTemplate>);
  vi.mocked(useSaveAsTemplate).mockReturnValue({ mutate: saveAs, isPending: false, isSuccess: false } as unknown as ReturnType<typeof useSaveAsTemplate>);
  vi.mocked(useDeleteWorkout).mockReturnValue({ mutate: remove, isPending: false } as unknown as ReturnType<typeof useDeleteWorkout>);
  queryClient = new QueryClient();
  await clearGymStore();
});

describe("proposta Aggiorna modello nell'IPA", () => {
  it("compare una volta sola: la prima apertura la mostra e la riapertura no", () => {
    setTemplateProposals([9]);
    mockWorkout(finished);

    const first = renderDetail("/gym/history/9");
    expectProposalShown();
    expect(getSnapshot().templateProposals).toEqual([]);
    first.unmount();

    renderDetail("/gym/history/9");
    expectProposalHidden();
  });

  it("senza differenze dal modello non mostra nulla, ma toglie comunque l'id", () => {
    setTemplateProposals([9]);
    mockWorkout({ ...finished, template_diff: [] });

    renderDetail("/gym/history/9");

    expectProposalHidden();
    expect(getSnapshot().templateProposals).toEqual([]);
  });

  it("anche nel riepilogo (summary=1) consuma l'id e mostra il riquadro una volta sola", () => {
    setTemplateProposals([9]);
    mockWorkout(finished);

    const summary = renderDetail("/gym/history/9?summary=1");

    expectProposalShown();
    expect(getSnapshot().templateProposals).toEqual([]);
    summary.unmount();

    renderDetail("/gym/history/9");
    expectProposalHidden();
  });

  it("senza un id in lista il dettaglio non mostra la proposta", () => {
    setTemplateProposals([5]);
    mockWorkout(finished);

    renderDetail("/gym/history/9");

    expectProposalHidden();
    expect(getSnapshot().templateProposals).toEqual([5]);
  });

  it("fuori dall'IPA la lista non viene toccata e la proposta non compare", () => {
    platform.native = false;
    setTemplateProposals([9]);
    mockWorkout(finished);

    renderDetail("/gym/history/9");

    expectProposalHidden();
    expect(getSnapshot().templateProposals).toEqual([9]);
  });

  it("senza il workout caricato non consuma l'id", () => {
    setTemplateProposals([9]);
    vi.mocked(useWorkout).mockReturnValue({ data: undefined, isLoading: true, isError: false } as unknown as ReturnType<typeof useWorkout>);

    renderDetail("/gym/history/9");

    expect(getSnapshot().templateProposals).toEqual([9]);
  });
});

describe("riepilogo locale chiuso prima del sync", () => {
  it("il riepilogo segna subito l'allenamento, e il sync passa l'id del server alla lista", async () => {
    const uuid = finishedLocally();
    const summary = renderSummary(uuid);
    expect(getSnapshot().finished[0]?.templateProposal).toBe(true);
    summary.unmount();

    confirmNextPut();
    expect(await syncEntry(uuid, queryClient)).toBe("synced");
    expect(getSnapshot().finished).toHaveLength(0);
    expect(getSnapshot().templateProposals).toEqual([42]);

    // Dallo Storico il dettaglio mostra la proposta una volta, poi no.
    renderDetail("/gym/history/42");
    expectProposalShown();
    expect(getSnapshot().templateProposals).toEqual([]);
  });

  it("app chiusa con il riepilogo aperto: il segno è nel file, e dopo il sync la proposta compare una sola volta", async () => {
    const uuid = finishedLocally();
    const summary = renderSummary(uuid);
    // Chiusura senza attendere nulla; il passaggio in background scrive il file come farebbe iOS.
    summary.unmount();
    await flushGymStore();
    expect(storedFinished()).toEqual([expect.objectContaining({ workout: expect.objectContaining({ uuid }), templateProposal: true })]);

    // Riapertura: il sync riprende dal file e il server conferma.
    confirmNextPut();
    expect(await syncEntry(uuid, queryClient)).toBe("synced");
    expect(getSnapshot().templateProposals).toEqual([42]);

    const detail = renderDetail("/gym/history/42");
    expectProposalShown();
    detail.unmount();

    renderDetail("/gym/history/42");
    expectProposalHidden();
  });

  it("sync riuscito a riepilogo aperto: il riepilogo passa al server e il riquadro compare una volta sola", async () => {
    const uuid = finishedLocally();
    renderSummary(uuid);
    confirmNextPut();

    await act(async () => {
      expect(await syncEntry(uuid, queryClient)).toBe("synced");
    });

    expect(screen.getByRole("heading", { name: "Allenamento completato" })).toBeInTheDocument();
    expectProposalShown();
    expect(getSnapshot().templateProposals).toEqual([]);
  });
});
