import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Exercise,
  type OfflineSnapshot,
  type Template,
  type TemplateSummary,
  gymKeys,
} from "../../api/gym";
import { createQueryClient } from "../../lib/queryClient";
import { reportNetworkFailure, resetConnectivityForTests } from "../../native/connectivity";
import type { SyncOutcome } from "../../native/gymSync";
import {
  clearGymStore,
  dispatch,
  getSnapshot,
  startEmptyWorkout,
  startWorkoutFromTemplate,
} from "../../native/gymStore";
import GymStartPage from "./GymStartPage";
import LocalWorkoutDetailPage from "./LocalWorkoutDetailPage";
import WorkoutPage from "./WorkoutPage";

// Sessione locale dell'IPA (C17–C21): ogni azione è un dispatch sullo stato locale, senza richieste di rete.

const platform = vi.hoisted(() => ({ native: true }));
const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  deleteFile: vi.fn(),
  rename: vi.fn(),
}));

// Termina aspetta il sync: qui l'esito è quello scelto dal test, e la conferma del server è `sync.confirmedId`.
const sync = vi.hoisted(() => ({
  syncNow: vi.fn((_uuid: string, _timeoutMs: number): Promise<SyncOutcome | "timeout"> =>
    Promise.resolve<SyncOutcome | "timeout">("pending"),
  ),
  confirmedId: null as number | null,
}));

vi.mock("../../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("../../native/gymSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../native/gymSync")>()),
  syncNow: (uuid: string, timeoutMs: number) => sync.syncNow(uuid, timeoutMs),
  confirmedServerId: () => sync.confirmedId,
}));
vi.mock("../../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));
// Il selettore esercizi è ancora quello online (T24): qui si sceglie senza passare dalla sua ricerca.
vi.mock("../../components/gym/ExercisePicker", () => ({
  default: ({ onPick }: { onPick: (list: Exercise[]) => void }) => (
    <div>
      <button type="button" onClick={() => onPick([PANCA])}>
        Scegli Panca
      </button>
      <button type="button" onClick={() => onPick([SQUAT])}>
        Scegli Squat
      </button>
    </div>
  ),
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

const SQUAT: Exercise = { ...PANCA, id: 2, name: "Squat", primary_muscles: ["quadricipiti"] };
const LEG_PRESS: Exercise = { ...PANCA, id: 3, name: "Leg press", equipment: "macchina" };

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

const PUSH_SUMMARY: TemplateSummary = {
  id: PUSH.id,
  name: PUSH.name,
  folder_id: null,
  last_used_at: null,
  exercise_names: ["Panca piana"],
};

const SUPERSET: Template = {
  id: 4,
  name: "Superserie",
  folder_id: null,
  last_used_at: null,
  exercises: [
    {
      id: 21,
      exercise: PANCA,
      rest_seconds: 60,
      superset_group: 1,
      note: null,
      sets: [{ weight_kg: 50, reps: 10, duration_s: null }],
    },
    {
      id: 22,
      exercise: LEG_PRESS,
      rest_seconds: 120,
      superset_group: 1,
      note: null,
      sets: [{ weight_kg: 100, reps: 10, duration_s: null }],
    },
  ],
};

// Precedente e Max della Panca: due serie con Precedente, il Max solo sulla prima.
const SNAPSHOT: OfflineSnapshot = {
  server_now: "2026-10-15T10:00:00Z",
  exercises: [
    {
      exercise: PANCA,
      rest_seconds: 120,
      previous: [
        { weight_kg: 80, reps: 8, duration_s: null },
        { weight_kg: 80, reps: 6, duration_s: null },
      ],
      max: [{ weight_kg: 85, reps: 8, duration_s: null }],
    },
  ],
};

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  platform.native = true;
  queryClient = createQueryClient(true);
  queryClient.mount();
  // Nessuna richiesta deve partire: un fetch che registra e fallisce, come con la rete assente.
  fetchMock = vi.fn(() => Promise.reject(new TypeError("Load failed")));
  vi.stubGlobal("fetch", fetchMock);
  reportNetworkFailure();
  await clearGymStore();
});

afterEach(() => {
  queryClient.unmount();
  queryClient.clear();
  vi.unstubAllGlobals();
  resetConnectivityForTests();
});

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/gym" element={<GymStartPage />} />
          <Route path="/gym/workout" element={<WorkoutPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Elenco dei modelli in cache; il dettaglio di `PUSH` si mette solo se richiesto. */
function seedTemplates(withDetail: boolean) {
  queryClient.setQueryData(gymKeys.templates, { folders: [], templates: [PUSH_SUMMARY] });
  if (withDetail) queryClient.setQueryData(gymKeys.template(PUSH.id), PUSH);
}

function startFromTemplate(template: Template): string {
  const started = startWorkoutFromTemplate(template);
  if (!started.ok) throw new Error(started.error);
  return started.state.uuid;
}

function startEmpty(): string {
  const started = startEmptyWorkout();
  if (!started.ok) throw new Error(started.error);
  return started.state.uuid;
}

/** La card di un esercizio della sessione, che la pagina etichetta con il nome. */
function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("sessione locale nell'IPA", () => {
  it("C17: un allenamento da modello si completa offline, con timer e senza richieste né errori", async () => {
    seedTemplates(true);
    renderAt("/gym");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Push A" }));
    await user.click(screen.getByRole("button", { name: "Inizia allenamento" }));
    expect(await screen.findByRole("textbox", { name: "Nome allenamento" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Completa serie 1" }));
    expect(screen.getByRole("button", { name: "Annulla serie 1" })).toHaveAttribute("aria-pressed", "true");
    // Il primo render del timer può ancora avere il tick precedente: il valore si assesta al tick successivo.
    await waitFor(() => expect(screen.getByRole("timer", { name: "Riposo" })).toHaveTextContent("1:30"));

    await user.click(screen.getByRole("button", { name: "Completa serie 2" }));
    expect(screen.getByRole("button", { name: "Annulla serie 2" })).toHaveAttribute("aria-pressed", "true");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSnapshot().active?.workout.exercises[0].sets.every((set) => set.completed_at !== null)).toBe(true);
  });

  it("C18: in superserie il riposo parte solo quando si completa l'ultimo esercizio del gruppo", async () => {
    startFromTemplate(SUPERSET);
    renderAt("/gym/workout");
    const user = userEvent.setup();

    await user.click(within(card("Panca piana")).getByRole("button", { name: "Completa serie 1" }));
    expect(screen.queryByRole("timer", { name: "Riposo" })).not.toBeInTheDocument();

    await user.click(within(card("Leg press")).getByRole("button", { name: "Completa serie 1" }));
    await waitFor(() => expect(screen.getByRole("timer", { name: "Riposo" })).toHaveTextContent("2:00"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("C19: ✓ su una serie senza kg mostra 'Inserisci kg e ripetizioni' e la serie resta non completata", async () => {
    const uuid = startEmpty();
    dispatch(uuid, { type: "addExercises", exercises: [PANCA], snapshot: null });
    renderAt("/gym/workout");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Completa serie 1" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Inserisci kg e ripetizioni");
    expect(screen.getByRole("button", { name: "Completa serie 1" })).toHaveAttribute("aria-pressed", "false");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("C20: senza dettaglio del modello in cache e senza rete, l'anteprima non avvia nulla", async () => {
    seedTemplates(false);
    renderAt("/gym");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Push A" }));

    expect(await screen.findByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inizia allenamento" })).toBeDisabled();
    expect(getSnapshot().active).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("C21: un esercizio aggiunto offline riceve Precedente e Max dallo snapshot, o '—' se manca", async () => {
    queryClient.setQueryData(gymKeys.offlineSnapshot, SNAPSHOT);
    startEmpty();
    renderAt("/gym/workout");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "+ Aggiungi esercizio" }));
    await user.click(screen.getByRole("button", { name: "Scegli Panca" }));

    const panca = card("Panca piana");
    expect(within(panca).getByRole("button", { name: "Usa precedente serie 1" })).toHaveTextContent("80 kg × 8");
    expect(within(panca).getByRole("button", { name: "Usa precedente serie 2" })).toHaveTextContent("80 kg × 6");
    expect(within(panca).getByText("max 85 kg × 8")).toBeInTheDocument();
    expect(within(panca).getAllByText(/^max /)).toHaveLength(1);
    expect(within(panca).getByLabelText("kg serie 1")).toHaveValue("80");

    await user.click(screen.getByRole("button", { name: "+ Aggiungi esercizio" }));
    await user.click(screen.getByRole("button", { name: "Scegli Squat" }));

    expect(within(card("Squat")).getByRole("button", { name: "Usa precedente serie 1" })).toHaveTextContent("—");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** Mostra il percorso raggiunto dal dettaglio del server, che in questi test è solo una rotta di arrivo. */
function ServerDetailProbe() {
  const location = useLocation();
  return (
    <p>
      server: {location.pathname}
      {location.search}
    </p>
  );
}

function renderWorkoutRoutes() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gym/workout"]}>
        <Routes>
          <Route path="/gym/workout" element={<WorkoutPage />} />
          <Route path="/gym/history/local/:uuid" element={<LocalWorkoutDetailPage />} />
          <Route path="/gym/history/:id" element={<ServerDetailProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Termina nell'IPA", () => {
  const originalConfirm = window.confirm;

  beforeEach(() => {
    sync.syncNow.mockImplementation(() => Promise.resolve<SyncOutcome | "timeout">("pending"));
    sync.confirmedId = null;
    window.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    window.confirm = originalConfirm;
  });

  it("C31: senza sync in tempo si apre il riepilogo locale con le sole serie completate", async () => {
    sync.syncNow.mockResolvedValue("timeout");
    const uuid = startFromTemplate(PUSH);
    renderWorkoutRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Completa serie 1" }));
    await user.click(screen.getByRole("button", { name: "Termina" }));

    expect(await screen.findByText("Potrai aggiornare il modello dopo la sincronizzazione")).toBeInTheDocument();
    expect(sync.syncNow).toHaveBeenCalledWith(uuid, 5000);
    expect(screen.getByRole("heading", { name: "Allenamento completato" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Panca piana" })).getAllByRole("listitem")).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("C32: con rete il sync riesce in tempo e si apre il dettaglio del server con ?summary=1", async () => {
    sync.syncNow.mockResolvedValue("synced");
    sync.confirmedId = 9;
    const uuid = startFromTemplate(PUSH);
    renderWorkoutRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Completa serie 1" }));
    await user.click(screen.getByRole("button", { name: "Completa serie 2" }));
    await user.click(screen.getByRole("button", { name: "Termina" }));

    expect(await screen.findByText("server: /gym/history/9?summary=1")).toBeInTheDocument();
    expect(sync.syncNow).toHaveBeenCalledWith(uuid, 5000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un conflitto non è un successo: si apre il riepilogo locale", async () => {
    sync.syncNow.mockResolvedValue("conflict");
    sync.confirmedId = 9;
    startFromTemplate(PUSH);
    renderWorkoutRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Completa serie 1" }));
    await user.click(screen.getByRole("button", { name: "Termina" }));

    expect(await screen.findByText("Potrai aggiornare il modello dopo la sincronizzazione")).toBeInTheDocument();
    expect(screen.queryByText("server: /gym/history/9?summary=1")).not.toBeInTheDocument();
  });

  it("durante l'attesa del sync l'allenamento resta visibile e Termina è disabilitato", async () => {
    let resolveSync: (outcome: SyncOutcome | "timeout") => void = () => undefined;
    sync.syncNow.mockImplementation(() => new Promise((resolve) => (resolveSync = resolve)));
    startFromTemplate(PUSH);
    renderWorkoutRoutes();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Completa serie 1" }));
    await user.click(screen.getByRole("button", { name: "Termina" }));

    expect(screen.getByRole("textbox", { name: "Nome allenamento" })).toBeInTheDocument();
    expect(screen.queryByText("Nessun allenamento in corso.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Termina" })).toBeDisabled();

    resolveSync("timeout");
    expect(await screen.findByText("Potrai aggiornare il modello dopo la sincronizzazione")).toBeInTheDocument();
  });
});
