import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Exercise, type Template, gymKeys } from "../../api/gym";
import { createQueryClient } from "../../lib/queryClient";
import { clearGymStore, dispatch, getSnapshot, removeEntry, startWorkoutFromTemplate } from "../../native/gymStore";
import LocalWorkoutDetailPage from "./LocalWorkoutDetailPage";

// Riepilogo locale dopo Termina (C31) e dettaglio locale: si legge solo dallo stato locale e dalla cache del modello.

const platform = vi.hoisted(() => ({ native: true }));
const sync = vi.hoisted(() => ({ confirmedId: null as number | null }));
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
// Il server conferma o no: il test sceglie l'id che `confirmedServerId` restituisce.
vi.mock("../../native/gymSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../native/gymSync")>()),
  confirmedServerId: () => sync.confirmedId,
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

let queryClient: QueryClient;

beforeEach(async () => {
  platform.native = true;
  sync.confirmedId = null;
  queryClient = createQueryClient(true);
  queryClient.mount();
  await clearGymStore();
});

afterEach(() => {
  queryClient.unmount();
  queryClient.clear();
});

/** Mostra il percorso corrente, così il test vede dove la rotta ha portato. */
function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <p>
      {name}: {location.pathname}
      {location.search}
    </p>
  );
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/gym/history/local/:uuid" element={<LocalWorkoutDetailPage />} />
          <Route path="/gym/history/:id" element={<Probe name="server" />} />
          <Route path="/gym/history" element={<Probe name="storico" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Un allenamento da PUSH finito con una sola serie completata: la seconda è scartata, quindi nel riepilogo
 * c'è una serie in meno del modello.
 */
function finishedFromTemplate(): string {
  const started = startWorkoutFromTemplate(PUSH);
  if (!started.ok) throw new Error(started.error);
  const { uuid, exercises } = started.state;
  const [first] = exercises[0].sets;
  const done = dispatch(uuid, {
    type: "completeSet",
    setUuid: first.uuid,
    values: { weight_kg: 80, reps: 8, duration_s: null },
  });
  if (!done.ok) throw new Error(done.error);
  const finished = dispatch(uuid, { type: "finish", discardIncomplete: true });
  if (!finished.ok) throw new Error(finished.error);
  return uuid;
}

describe("riepilogo locale di un allenamento finito", () => {
  it("C31: mostra solo le serie completate, le modifiche rispetto al modello e la riga di sync, senza pulsanti", () => {
    queryClient.setQueryData(gymKeys.template(PUSH.id), PUSH);
    const uuid = finishedFromTemplate();
    renderAt(`/gym/history/local/${uuid}?summary=1`);

    expect(screen.getByRole("heading", { name: "Allenamento completato" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Push A" })).toBeInTheDocument();

    const panca = screen.getByRole("region", { name: "Panca piana" });
    expect(within(panca).getAllByRole("listitem")).toHaveLength(1);
    expect(within(panca).getByText("80 kg × 8")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Modifiche rispetto al modello" })).toBeInTheDocument();
    expect(screen.getByText("Panca piana: -1 serie")).toBeInTheDocument();
    expect(screen.getByText("Potrai aggiornare il modello dopo la sincronizzazione")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aggiorna modello" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salva come modello" })).not.toBeInTheDocument();
  });

  it("senza il modello in cache non mostra le modifiche, ma la riga di sync sì", () => {
    const uuid = finishedFromTemplate();
    renderAt(`/gym/history/local/${uuid}?summary=1`);

    expect(screen.queryByRole("heading", { name: "Modifiche rispetto al modello" })).not.toBeInTheDocument();
    expect(screen.getByText("Potrai aggiornare il modello dopo la sincronizzazione")).toBeInTheDocument();
  });

  it("senza ?summary=1 mostra lo stesso dettaglio, con il nome e senza la riga di sync", () => {
    const uuid = finishedFromTemplate();
    renderAt(`/gym/history/local/${uuid}`);

    expect(screen.getByRole("heading", { level: 1, name: "Push A" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Panca piana" })).toBeInTheDocument();
    expect(screen.queryByText("Potrai aggiornare il modello dopo la sincronizzazione")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Fine" })).not.toBeInTheDocument();
  });

  it("quando il server conferma mentre il riepilogo è aperto, la rotta passa a quella del server", () => {
    const uuid = finishedFromTemplate();
    renderAt(`/gym/history/local/${uuid}?summary=1`);
    expect(screen.getByText("Potrai aggiornare il modello dopo la sincronizzazione")).toBeInTheDocument();

    // Il sync toglie la voce dallo store e il server ha un id: lo stesso effetto di `applyAccepted`.
    sync.confirmedId = 9;
    act(() => {
      removeEntry(uuid);
    });

    expect(screen.getByText("server: /gym/history/9?summary=1")).toBeInTheDocument();
    expect(getSnapshot().finished).toHaveLength(0);
  });

  it("un uuid senza voce locale né conferma porta allo Storico", () => {
    renderAt("/gym/history/local/non-esiste?summary=1");

    expect(screen.getByText("storico: /gym/history")).toBeInTheDocument();
  });
});
