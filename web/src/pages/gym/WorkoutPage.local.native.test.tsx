import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Exercise,
  type OfflineSnapshot,
  type Template,
  type TemplateSummary,
  gymKeys,
} from "../../api/gym";
import { ApiError } from "../../api/client";
import { createQueryClient } from "../../lib/queryClient";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "../../native/connectivity";
import NativeBridge from "../../native/NativeBridge";
import { type SyncOutcome, startGymSync } from "../../native/gymSync";
import {
  clearGymStore,
  dispatch,
  getSnapshot,
  patchEntry,
  startEmptyWorkout,
  startWorkoutFromTemplate,
} from "../../native/gymStore";
import { useLocalSession } from "../../native/localSession";
import { clearToken, setToken } from "../../native/session";
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
const preferences = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
const api = vi.hoisted(() => ({ deleteWorkoutChecked: vi.fn() }));
const restNotifications = vi.hoisted(() => ({
  syncRestNotification: vi.fn<(workout: unknown, offsetMs?: number) => Promise<void>>(() => Promise.resolve()),
  installNotificationSound: vi.fn(() => Promise.resolve()),
}));
const localNotifications = vi.hoisted(() => ({ addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) }));

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
vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: localNotifications }));
vi.mock("../../native/restNotifications", () => restNotifications);
vi.mock("../../api/gym", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/gym")>()),
  deleteWorkoutChecked: api.deleteWorkoutChecked,
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

  it("se onSuccess lancia, la fase di Termina finisce lo stesso e Termina torna disponibile", async () => {
    sync.syncNow.mockResolvedValue("timeout");
    const uuid = startFromTemplate(PUSH);
    const setUuid = getSnapshot().active?.workout.exercises[0].sets[0].uuid ?? "";
    expect(dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 80, reps: 8, duration_s: null } }).ok).toBe(true);
    // Il rifiuto di onSuccess resta non gestito: il test controlla solo lo stato di fase, non il rifiuto.
    const unhandled = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    process.on("unhandledRejection", () => undefined);
    try {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(() => useLocalSession(), { wrapper });
      act(() => {
        result.current?.finish(true, {
          onError: vi.fn(),
          onSuccess: () => {
            throw new Error("navigazione fallita");
          },
        });
      });
      expect(result.current?.isFinishing).toBe(true);
      // Senza allenamento né fase di Termina l'hook restituisce null: conta solo che la fase non resti aperta.
      await waitFor(() => expect(result.current?.isFinishing ?? false).toBe(false));
      expect(sync.syncNow).toHaveBeenCalledWith(uuid, 5000);
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of unhandled) process.on("unhandledRejection", listener);
    }
  });
});

/** Il percorso di arrivo dopo l'annullamento, e la navigazione verso di esso. */
function renderCancel() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gym/workout"]}>
        <NativeBridge />
        <Routes>
          <Route path="/gym/workout" element={<WorkoutPage />} />
          <Route path="/gym" element={<p>Pagina dei modelli</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Allenamento già sincronizzato: id 42 e versione 1, senza modifiche in attesa.
function markSynced(uuid: string): void {
  const active = getSnapshot().active;
  if (active === null || active.workout.uuid !== uuid) throw new Error("allenamento non attivo");
  patchEntry(uuid, {
    baseVersion: 1,
    sentRevision: active.revision,
    sync: "synced",
    workout: { ...active.workout, id: 42 },
  });
}

/** Richieste che scrivono (PUT, DELETE) passate al fetch: con la rete assente devono restare zero. */
function writeRequests(): RequestInit[] {
  const calls = fetchMock.mock.calls as unknown as [unknown, RequestInit | undefined][];
  return calls.map(([, init]) => init ?? {}).filter((init) => (init.method ?? "GET") !== "GET");
}

/** Lascia girare il sync e le promise dopo un cambio di rete. */
async function letNetworkWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("Annulla allenamento nell'IPA", () => {
  const originalConfirm = window.confirm;
  let stopSync: (() => void) | undefined;

  beforeEach(async () => {
    window.confirm = vi.fn(() => true);
    // Con la rete tornata il sync legge l'attivo del server: una risposta 204 (nessun attivo) dice che la rete c'è.
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    api.deleteWorkoutChecked.mockReset();
    api.deleteWorkoutChecked.mockResolvedValue(undefined);
    restNotifications.syncRestNotification.mockClear();
    await setToken("tok-annulla");
  });

  afterEach(async () => {
    stopSync?.();
    stopSync = undefined;
    window.confirm = originalConfirm;
    await clearToken();
  });

  it("C33: un allenamento mai sincronizzato annullato offline sparisce e al ritorno della rete non parte nessuna richiesta", async () => {
    startFromTemplate(PUSH);
    stopSync = startGymSync(queryClient);
    renderCancel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Annulla allenamento" }));

    expect(await screen.findByText("Pagina dei modelli")).toBeInTheDocument();
    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().pendingDeletes).toHaveLength(0);

    reportNetworkSuccess();
    await letNetworkWork();

    expect(writeRequests()).toHaveLength(0);
    expect(api.deleteWorkoutChecked).not.toHaveBeenCalled();
  });

  it("la notifica di riposo si cancella con l'annullamento", async () => {
    const uuid = startFromTemplate(PUSH);
    dispatch(uuid, { type: "restStart", seconds: 90 });
    renderCancel();
    const user = userEvent.setup();
    expect(restNotifications.syncRestNotification.mock.calls.at(-1)?.[0]).toMatchObject({ name: "Push A" });

    await user.click(screen.getByRole("button", { name: "Annulla allenamento" }));

    expect(await screen.findByText("Pagina dei modelli")).toBeInTheDocument();
    expect(restNotifications.syncRestNotification.mock.calls.at(-1)?.[0]).toBeNull();
  });

  it("C53: annullato offline un allenamento sincronizzato sparisce subito; alla rete il DELETE con la versione nota dà conflitto, senza altri DELETE", async () => {
    const uuid = startFromTemplate(PUSH);
    markSynced(uuid);
    stopSync = startGymSync(queryClient);
    renderCancel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Annulla allenamento" }));

    expect(await screen.findByText("Pagina dei modelli")).toBeInTheDocument();
    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().pendingDeletes).toEqual([expect.objectContaining({ id: 42, baseVersion: 1 })]);
    await letNetworkWork();
    expect(api.deleteWorkoutChecked).not.toHaveBeenCalled();

    api.deleteWorkoutChecked.mockRejectedValueOnce(
      new ApiError(409, "version_conflict", { detail: "version_conflict", current: null }),
    );
    reportNetworkSuccess();
    await letNetworkWork();

    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
    expect(api.deleteWorkoutChecked).toHaveBeenCalledWith(42, 1);
    expect(getSnapshot().pendingDeletes).toHaveLength(0);
    expect(getSnapshot().active).toMatchObject({ sync: "conflict", conflict: { reason: "version_conflict" }, workout: { uuid, id: 42 } });

    reportNetworkFailure();
    reportNetworkSuccess();
    await letNetworkWork();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledTimes(1);
  });

  it("con rete e sincronizzato: DELETE come oggi, poi l'allenamento esce dal telefono", async () => {
    reportNetworkSuccess();
    const uuid = startFromTemplate(PUSH);
    markSynced(uuid);
    renderCancel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Annulla allenamento" }));

    expect(await screen.findByText("Pagina dei modelli")).toBeInTheDocument();
    expect(api.deleteWorkoutChecked).toHaveBeenCalledWith(42);
    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().pendingDeletes).toHaveLength(0);
  });

  it("DELETE con rete caduta a metà: l'annullamento resta in attesa e l'allenamento esce comunque", async () => {
    reportNetworkSuccess();
    const uuid = startFromTemplate(PUSH);
    markSynced(uuid);
    api.deleteWorkoutChecked.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderCancel();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Annulla allenamento" }));

    expect(await screen.findByText("Pagina dei modelli")).toBeInTheDocument();
    expect(getSnapshot().active).toBeNull();
    expect(getSnapshot().pendingDeletes).toEqual([expect.objectContaining({ id: 42, baseVersion: 1 })]);
  });
});
