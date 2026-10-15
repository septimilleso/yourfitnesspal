import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise, Template, Workout } from "../../api/gym";
import { resolveConflict } from "../../native/gymSync";
import {
  clearGymStore,
  dispatch,
  getSnapshot,
  patchEntry,
  startWorkoutFromTemplate,
} from "../../native/gymStore";
import SyncConflictDialog from "./SyncConflictDialog";

// Dialogo di conflitto (R18, C29, C30): lato interfaccia. La scelta chiama `resolveConflict`, che è mockato qui.

const platform = vi.hoisted(() => ({ native: true }));
const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  deleteFile: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("../../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("../../native/gymSync", () => ({ resolveConflict: vi.fn() }));

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

const PUSH: Template = {
  id: 3,
  name: "Push A",
  folder_id: null,
  last_used_at: null,
  exercises: [
    {
      id: 11,
      exercise: PANCA,
      rest_seconds: 90,
      superset_group: null,
      note: null,
      sets: [
        { weight_kg: 80, reps: 8, duration_s: null },
        { weight_kg: 80, reps: 6, duration_s: null },
      ],
    },
  ],
};

/** Copia del server: un allenamento in corso con tre serie, nessuna completata. */
const SERVER_COPY = {
  id: 42,
  uuid: "server-uuid",
  version: 5,
  name: "Allenamento sul server",
  template_id: 3,
  status: "in_progress",
  started_at: "2026-10-14T18:00:00Z",
  finished_at: null,
  rest_ends_at: null,
  rest_total_s: null,
  server_now: "2026-10-14T18:30:00Z",
  template_diff: [],
  exercises: [
    {
      id: 7,
      uuid: "server-ex",
      exercise: PANCA,
      rest_seconds: 90,
      superset_group: null,
      note: null,
      sets: [0, 1, 2].map((index) => ({
        id: 100 + index,
        uuid: `server-set-${index}`,
        weight_kg: 80,
        reps: 8,
        duration_s: null,
        completed_at: null,
        previous: null,
      })),
    },
  ],
} as unknown as Workout;

const resolve = vi.mocked(resolveConflict);
let uuid: string;

beforeEach(async () => {
  platform.native = true;
  resolve.mockReset();
  resolve.mockResolvedValue("synced");
  await clearGymStore();
  const started = startWorkoutFromTemplate(PUSH);
  if (!started.ok) throw new Error(started.error);
  uuid = started.state.uuid;
  const [first] = started.state.exercises[0].sets;
  const done = dispatch(uuid, {
    type: "completeSet",
    setUuid: first.uuid,
    values: { weight_kg: 80, reps: 8, duration_s: null },
  });
  if (!done.ok) throw new Error(done.error);
});

afterEach(() => {
  platform.native = true;
});

/** Mette l'allenamento locale in conflitto con la copia indicata (come fa il sync dopo un 409). */
function conflictWith(reason: string, current: Workout | null) {
  patchEntry(uuid, { sync: "conflict", conflict: { reason, current } });
}

describe("SyncConflictDialog", () => {
  it("C29: mostra il riepilogo delle due copie e le due scelte", () => {
    conflictWith("version_conflict", SERVER_COPY);
    render(<SyncConflictDialog />);

    const dialog = screen.getByRole("dialog", { name: "Allenamento in conflitto" });
    const phone = within(dialog).getByRole("region", { name: "Telefono" });
    expect(within(phone).getByText("Push A")).toBeInTheDocument();
    expect(within(phone).getByText("Serie completate: 1 su 2")).toBeInTheDocument();
    expect(within(phone).getByText("Stato: in corso")).toBeInTheDocument();

    const server = within(dialog).getByRole("region", { name: "Server" });
    expect(within(server).getByText("Allenamento sul server")).toBeInTheDocument();
    expect(within(server).getByText("Serie completate: 0 su 3")).toBeInTheDocument();
    expect(within(server).getByText("Esercizi: 1")).toBeInTheDocument();

    expect(within(dialog).getByRole("button", { name: "Tieni la copia del telefono" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Tieni la copia del server" })).toBeEnabled();
  });

  it("mostra 'Eliminato sul server' quando la copia del server non c'è", () => {
    conflictWith("version_conflict", null);
    render(<SyncConflictDialog />);

    expect(screen.getByText("Eliminato sul server")).toBeInTheDocument();
  });

  it("C30: con un altro allenamento in corso sul server lo dice nel testo", () => {
    conflictWith("other_active", SERVER_COPY);
    render(<SyncConflictDialog />);

    expect(screen.getByText(/Sul server c'è un altro allenamento in corso/)).toBeInTheDocument();
    expect(screen.getByText(/quell'altro allenamento viene annullato/)).toBeInTheDocument();
  });

  it("'Tieni la copia del telefono' chiama resolveConflict con 'local'", async () => {
    conflictWith("version_conflict", SERVER_COPY);
    render(<SyncConflictDialog />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tieni la copia del telefono" }));
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(uuid, "local");
  });

  it("'Tieni la copia del server' chiama resolveConflict con 'server'", async () => {
    conflictWith("version_conflict", SERVER_COPY);
    render(<SyncConflictDialog />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tieni la copia del server" }));
    });

    expect(resolve).toHaveBeenCalledWith(uuid, "server");
  });

  it("se la copia del server non può prendere il posto dell'attivo, lo dice e il dialogo resta", async () => {
    conflictWith("version_conflict", SERVER_COPY);
    resolve.mockResolvedValue("conflict");
    render(<SyncConflictDialog />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tieni la copia del server" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Sul telefono c'è già un allenamento in corso");
    expect(screen.getByRole("dialog", { name: "Allenamento in conflitto" })).toBeInTheDocument();
  });

  it("senza rete la scelta non è inviata e lo dice", async () => {
    conflictWith("version_conflict", SERVER_COPY);
    resolve.mockResolvedValue("pending");
    render(<SyncConflictDialog />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tieni la copia del telefono" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("La scelta non è stata inviata");
  });

  it("un conflitto nato da un annullamento, nello stato dei finiti, mostra lo stesso dialogo", () => {
    dispatch(uuid, { type: "finish", discardIncomplete: true });
    conflictWith("version_conflict", SERVER_COPY);
    expect(getSnapshot().finished).toHaveLength(1);
    render(<SyncConflictDialog />);

    expect(screen.getByRole("dialog", { name: "Allenamento in conflitto" })).toBeInTheDocument();
    expect(screen.getByText("Stato: finito")).toBeInTheDocument();
  });

  it("non compare senza conflitti", () => {
    render(<SyncConflictDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("nel browser non compare mai", () => {
    platform.native = false;
    conflictWith("version_conflict", SERVER_COPY);
    render(<SyncConflictDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
