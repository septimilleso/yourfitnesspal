import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise, HistoryItem, Template } from "../../api/gym";
import { useDeleteWorkout, useHistory } from "../../api/gym";
import { createQueryClient } from "../../lib/queryClient";
import { clearGymStore, dispatch, getSnapshot, patchEntry, startWorkoutFromTemplate } from "../../native/gymStore";
import HistoryPage from "./HistoryPage";
import LocalWorkoutDetailPage from "./LocalWorkoutDetailPage";

// Storico nell'IPA con gli allenamenti da sincronizzare (R22, C35), e il dettaglio locale senza menu (C49).

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
vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useHistory: vi.fn(), useDeleteWorkout: vi.fn() };
});
vi.mock("../../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));

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

const serverItems: HistoryItem[] = [
  {
    id: 9,
    name: "Giorno dal server",
    started_at: "2026-10-02T18:00:00Z",
    finished_at: "2026-10-02T19:00:00Z",
    exercises: [{ name: "Squat", sets: 3 }],
  },
];

let queryClient: QueryClient;

beforeEach(async () => {
  platform.native = true;
  queryClient = createQueryClient(true);
  queryClient.mount();
  await clearGymStore();
  vi.mocked(useDeleteWorkout).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
    typeof useDeleteWorkout
  >);
  mockHistory(serverItems);
});

afterEach(() => {
  queryClient.unmount();
  queryClient.clear();
});

function mockHistory(items: HistoryItem[]) {
  vi.mocked(useHistory).mockReturnValue({
    data: { pages: [{ items, next_before: null }], pageParams: [null] },
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    fetchStatus: "idle",
  } as unknown as ReturnType<typeof useHistory>);
}

/** Un allenamento da PUSH finito sul telefono, con una sola serie completata. */
function finishedLocally(): string {
  const started = startWorkoutFromTemplate(PUSH);
  if (!started.ok) throw new Error(started.error);
  const { uuid, exercises } = started.state;
  const done = dispatch(uuid, {
    type: "completeSet",
    setUuid: exercises[0].sets[0].uuid,
    values: { weight_kg: 80, reps: 8, duration_s: null },
  });
  if (!done.ok) throw new Error(done.error);
  const finished = dispatch(uuid, { type: "finish", discardIncomplete: true });
  if (!finished.ok) throw new Error(finished.error);
  return uuid;
}

function renderHistory() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gym/history"]}>
        <Routes>
          <Route path="/gym/history" element={<HistoryPage />} />
          <Route path="/gym/history/local/:uuid" element={<LocalWorkoutDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Storico con gli allenamenti da sincronizzare", () => {
  it("C35: l'allenamento finito solo sul telefono compare in cima, con l'etichetta e il link al dettaglio locale", () => {
    const uuid = finishedLocally();
    const { container } = renderHistory();

    const card = screen.getByRole("link", { name: /Push A/ });
    expect(card).toHaveAttribute("href", `/gym/history/local/${uuid}`);
    expect(within(card).getByText("Da sincronizzare")).toBeInTheDocument();

    // Prima degli allenamenti del server.
    const serverCard = screen.getByRole("link", { name: /Giorno dal server/ });
    expect(card.compareDocumentPosition(serverCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Niente scorrimento per eliminare: la card locale non è un SwipeableCard, quella del server sì.
    expect(card.closest("[data-swipeable-id]")).toBeNull();
    expect(container.querySelectorAll("[data-swipeable-id]")).toHaveLength(1);
  });

  it("mostra 'Conflitto' ed 'Errore di sincronizzazione' secondo lo stato di sync", () => {
    const conflicted = finishedLocally();
    const failed = finishedLocally();
    patchEntry(conflicted, { sync: "conflict", conflict: { reason: "version_conflict", current: null } });
    patchEntry(failed, { sync: "error" });
    renderHistory();

    // Le due voci hanno la stessa ora di fine: l'ordine tra loro non è il punto, quindi le cerco per link.
    const conflictCard = screen.getByRole("link", { name: /Conflitto/ });
    expect(conflictCard).toHaveAttribute("href", `/gym/history/local/${conflicted}`);
    const errorCard = screen.getByRole("link", { name: /Errore di sincronizzazione/ });
    expect(errorCard).toHaveAttribute("href", `/gym/history/local/${failed}`);
    expect(screen.getAllByRole("link", { name: /Push A/ })).toHaveLength(2);
  });

  it("una voce locale con un id già nello Storico del server non si mostra due volte", () => {
    const uuid = finishedLocally();
    patchEntry(uuid, { workout: { ...getEntryWorkout(uuid), id: 9 } });
    renderHistory();

    expect(screen.queryByText("Da sincronizzare")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Giorno dal server/ })).toHaveLength(1);
  });

  it("nel browser le voci locali non compaiono", () => {
    platform.native = false;
    finishedLocally();
    renderHistory();

    expect(screen.queryByText("Da sincronizzare")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Giorno dal server/ })).toBeInTheDocument();
  });

  it("senza allenamenti sul server ma con uno locale, non dice 'Nessun allenamento completato'", () => {
    mockHistory([]);
    finishedLocally();
    renderHistory();

    expect(screen.getByRole("link", { name: /Push A/ })).toBeInTheDocument();
    expect(screen.queryByText("Nessun allenamento completato.")).not.toBeInTheDocument();
  });

  it("C49: il dettaglio locale apre senza menu di azioni e senza il riepilogo", () => {
    finishedLocally();
    renderHistory();

    fireEvent.click(screen.getByRole("link", { name: /Push A/ }));

    expect(screen.getByRole("region", { name: "Panca piana" })).toBeInTheDocument();
    expect(screen.queryByText("Potrai aggiornare il modello dopo la sincronizzazione")).not.toBeInTheDocument();
    // Solo il pulsante di ritorno: niente "•••", niente Elimina né Salva come modello.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "‹ Storico" })).toBeInTheDocument();
  });
});

function getEntryWorkout(uuid: string) {
  const entry = getSnapshot().finished.find((item) => item.workout.uuid === uuid);
  if (entry === undefined) throw new Error("voce non trovata");
  return entry.workout;
}
