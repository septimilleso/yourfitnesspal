import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Exercise, type OfflineSnapshot, type Template, EMPTY_FILTERS, gymKeys } from "../../api/gym";
import { createQueryClient } from "../../lib/queryClient";
import { reportNetworkFailure, resetConnectivityForTests } from "../../native/connectivity";
import ExercisePicker from "./ExercisePicker";

// Selettore esercizi nell'IPA offline (C22, R14): cerca tra gli esercizi già sul dispositivo.

const platform = vi.hoisted(() => ({ native: true }));

vi.mock("../../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("./CustomExerciseForm", () => ({ default: () => <div data-testid="custom-form" /> }));

const PANCA: Exercise = {
  id: 1, name: "Panca piana", equipment: "barbell", primary_muscles: ["chest"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};
const BACK_SQUAT: Exercise = { ...PANCA, id: 2, name: "Back Squat", primary_muscles: ["quadriceps"] };
const FRONT_SQUAT: Exercise = { ...BACK_SQUAT, id: 3, name: "Front Squat" };
const GOBLET_SQUAT: Exercise = { ...BACK_SQUAT, id: 4, name: "Goblet Squat", equipment: "dumbbell" };
const LEG_CURL: Exercise = { ...PANCA, id: 5, name: "Leg Curl", equipment: "machine", primary_muscles: ["hamstrings"] };

// Catalogo in cache (senza filtri), snapshot e un modello: Back Squat compare in due fonti, il test deve vederlo una volta.
const SNAPSHOT: OfflineSnapshot = {
  server_now: "2026-10-15T10:00:00Z",
  exercises: [
    { exercise: BACK_SQUAT, rest_seconds: 120, previous: [], max: [] },
    { exercise: FRONT_SQUAT, rest_seconds: 120, previous: [], max: [] },
  ],
};

const MODEL: Template = {
  id: 7,
  name: "Gambe",
  folder_id: null,
  last_used_at: null,
  exercises: [
    { id: 71, exercise: GOBLET_SQUAT, rest_seconds: 90, superset_group: null, note: null, sets: [] },
    { id: 72, exercise: LEG_CURL, rest_seconds: 90, superset_group: null, note: null, sets: [] },
  ],
};

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  platform.native = true;
  queryClient = createQueryClient(true);
  queryClient.mount();
  queryClient.setQueryData(gymKeys.exercises(EMPTY_FILTERS), { items: [PANCA, BACK_SQUAT], total: 2 });
  queryClient.setQueryData(gymKeys.offlineSnapshot, SNAPSHOT);
  queryClient.setQueryData(gymKeys.template(MODEL.id), MODEL);
  // Nessuna richiesta deve partire offline: un fetch che registra e fallisce.
  fetchMock = vi.fn(() => Promise.reject(new TypeError("Load failed")));
  vi.stubGlobal("fetch", fetchMock);
  reportNetworkFailure();
});

afterEach(() => {
  queryClient.unmount();
  queryClient.clear();
  vi.unstubAllGlobals();
  resetConnectivityForTests();
});

function renderPicker(props: { multiple?: boolean; onPick?: (list: Exercise[]) => void } = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ExercisePicker onPick={props.onPick ?? vi.fn()} onClose={vi.fn()} multiple={props.multiple} />
    </QueryClientProvider>,
  );
}

describe("ExercisePicker offline nell'IPA", () => {
  it("C22: cercando squat mostra gli esercizi locali senza duplicati e nessuna richiesta", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.type(screen.getByLabelText("Cerca esercizio"), "squat");

    expect(screen.getAllByRole("button", { name: /Back Squat/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Front Squat/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Goblet Squat/ })).toHaveLength(1);
    expect(screen.queryByText(/Panca piana/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Leg Curl/)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filtra per attrezzo e per muscolo sugli esercizi locali", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.selectOptions(screen.getByLabelText("Attrezzo"), "machine");
    expect(screen.getByRole("button", { name: /Leg Curl/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back Squat/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Attrezzo"), "");
    await user.selectOptions(screen.getByLabelText("Muscolo"), "quadriceps");
    expect(screen.getByRole("button", { name: /Back Squat/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Goblet Squat/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Leg Curl/ })).not.toBeInTheDocument();
  });

  it("restituisce l'esercizio scelto dalla lista locale in modalità singola", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderPicker({ multiple: false, onPick });

    await user.click(screen.getByRole("button", { name: /Leg Curl/ }));

    expect(onPick).toHaveBeenCalledWith([LEG_CURL]);
  });

  it("+ Nuovo mostra Non disponibile offline e non apre il form", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("button", { name: "+ Nuovo" }));

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByTestId("custom-form")).not.toBeInTheDocument();
  });

  it("senza nulla in cache mostra l'elenco vuoto, non l'errore di rete", () => {
    queryClient.clear();
    renderPicker();

    expect(screen.getByText("Nessun esercizio trovato.")).toBeInTheDocument();
    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
  });

  it("fuori dall'IPA, anche senza rete, + Nuovo apre il form e non il messaggio offline", async () => {
    platform.native = false;
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("button", { name: "+ Nuovo" }));
    expect(screen.getByTestId("custom-form")).toBeInTheDocument();
    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
  });
});
