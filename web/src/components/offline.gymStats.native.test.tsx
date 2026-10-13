import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../api/gym";
import {
  useArchiveExercise,
  useExercise,
  useExercises,
  useExerciseProgress,
  useGymCount,
  useGymStats,
  usePerformedExercises,
} from "../api/gym";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "../native/connectivity";
import { pausedQuery, retryingQuery } from "../test/offlineQuery";
import GymStatsPage from "../pages/gym/GymStatsPage";
import ExerciseDetailSheet from "./gym/ExerciseDetailSheet";
import ExerciseList from "./gym/ExerciseList";
import ExercisePicker from "./gym/ExercisePicker";
import ExerciseProgressSection from "./stats/ExerciseProgressSection";
import WorkoutCountCard from "./WorkoutCountCard";

vi.mock("../native/platform", () => ({ isNative: () => true }));
vi.mock("../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../api/gym")>("../api/gym");
  return {
    ...actual,
    useExercise: vi.fn(),
    useArchiveExercise: vi.fn(),
    useExercises: vi.fn(),
    useGymStats: vi.fn(),
    useGymCount: vi.fn(),
    usePerformedExercises: vi.fn(),
    useExerciseProgress: vi.fn(),
  };
});
vi.mock("./ModeSwitch", () => ({ default: () => null }));

const squat: Exercise = {
  id: 1, name: "Barbell Squat", equipment: "barbell", primary_muscles: ["quadriceps"],
  secondary_muscles: [], category: "strength", tracking: "weight_reps", custom: false,
};
const curl: Exercise = { ...squat, id: 2, name: "Dumbbell Curl", equipment: "dumbbell", primary_muscles: ["biceps"] };

const period = { start: "2026-09-19", end: "2026-09-25" };

/** Stessa forma per tutte le query della palestra: pausa, ripresa o dati. */
function mockAllQueries(query: object) {
  vi.mocked(useExercise).mockReturnValue(query as unknown as ReturnType<typeof useExercise>);
  vi.mocked(useExercises).mockReturnValue(query as unknown as ReturnType<typeof useExercises>);
  vi.mocked(useGymStats).mockReturnValue(query as unknown as ReturnType<typeof useGymStats>);
  vi.mocked(useGymCount).mockReturnValue(query as unknown as ReturnType<typeof useGymCount>);
  vi.mocked(usePerformedExercises).mockReturnValue(query as unknown as ReturnType<typeof usePerformedExercises>);
  vi.mocked(useExerciseProgress).mockReturnValue(query as unknown as ReturnType<typeof useExerciseProgress>);
}

const components = [
  {
    name: "ExerciseList",
    // Testi che non devono comparire: caricamento, errore ed elenco vuoto.
    forbidden: ["Caricamento...", "Errore nel caricamento.", "Nessun esercizio trovato."],
    renderComponent: (query: object) => {
      render(<ExerciseList query={query as ReturnType<typeof useExercises>} onSelect={vi.fn()} />);
    },
  },
  {
    name: "ExerciseDetailSheet",
    forbidden: ["Caricamento...", "Errore nel caricamento."],
    renderComponent: (query: object) => {
      mockAllQueries(query);
      render(<ExerciseDetailSheet exerciseId={1} onClose={vi.fn()} />);
    },
  },
  {
    name: "GymStatsPage",
    forbidden: ["Caricamento...", "Impossibile caricare le statistiche.", "Caricamento esercizi...", "Caricamento progressione..."],
    renderComponent: (query: object) => {
      mockAllQueries(query);
      render(
        <MemoryRouter initialEntries={["/gym/stats"]}>
          <GymStatsPage />
        </MemoryRouter>,
      );
    },
  },
  {
    name: "WorkoutCountCard",
    forbidden: ["Caricamento...", "Impossibile caricare gli allenamenti."],
    renderComponent: (query: object) => {
      mockAllQueries(query);
      render(<WorkoutCountCard />);
    },
  },
  {
    name: "ExerciseProgressSection",
    forbidden: [
      "Caricamento esercizi...",
      "Caricamento progressione...",
      "Impossibile caricare gli esercizi.",
      "Completa un allenamento per vedere i progressi",
    ],
    renderComponent: (query: object) => {
      mockAllQueries(query);
      render(
        <MemoryRouter>
          <ExerciseProgressSection period={period} enabled />
        </MemoryRouter>,
      );
    },
  },
];

beforeEach(() => {
  reportNetworkFailure();
  vi.mocked(useArchiveExercise).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useArchiveExercise>);
});

afterEach(() => {
  resetConnectivityForTests();
});

describe.each(components)("$name offline", ({ forbidden, renderComponent }) => {
  it("con la query in pausa mostra Non disponibile offline e non mostra caricamento né elenco vuoto", () => {
    renderComponent(pausedQuery());

    expect(screen.getAllByText("Non disponibile offline").length).toBeGreaterThan(0);
    for (const text of forbidden) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  it("con la query di nuovo in fetching il messaggio resta e Caricamento non compare", () => {
    renderComponent(retryingQuery());

    expect(screen.getAllByText("Non disponibile offline").length).toBeGreaterThan(0);
    for (const text of forbidden) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  it("con la rete presente il messaggio non compare e la query in fetching mostra Caricamento", () => {
    reportNetworkSuccess();
    renderComponent(retryingQuery());

    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Caricamento/).length).toBeGreaterThan(0);
  });

  it("con la rete presente e la query in pausa il messaggio non compare", () => {
    reportNetworkSuccess();
    renderComponent(pausedQuery());

    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
  });
});

describe("ExerciseList offline", () => {
  it("C11: con dati placeholder in pausa mostra il messaggio al posto dell'elenco", () => {
    const placeholder = {
      data: { items: [squat, curl], total: 2 },
      isLoading: false,
      isError: false,
      isPlaceholderData: true,
      fetchStatus: "paused",
    };

    render(<ExerciseList query={placeholder as unknown as ReturnType<typeof useExercises>} onSelect={vi.fn()} />);

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Barbell Squat")).not.toBeInTheDocument();
    expect(screen.queryByText("Dumbbell Curl")).not.toBeInTheDocument();
  });

  it("con la rete presente i dati placeholder restano visibili", () => {
    reportNetworkSuccess();
    const placeholder = {
      data: { items: [squat], total: 1 },
      isLoading: false,
      isError: false,
      isPlaceholderData: true,
      fetchStatus: "idle",
    };

    render(<ExerciseList query={placeholder as unknown as ReturnType<typeof useExercises>} onSelect={vi.fn()} />);

    expect(screen.getByText("Barbell Squat")).toBeInTheDocument();
    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
  });
});

describe("ExercisePicker offline", () => {
  it("con il catalogo in pausa mostra il messaggio e il pulsante Aggiungi resta disabilitato", () => {
    mockAllQueries(pausedQuery());

    render(<ExercisePicker onPick={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento...")).not.toBeInTheDocument();
    expect(screen.queryByText("Nessun esercizio trovato.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aggiungi (0)" })).toBeDisabled();
  });
});

describe("ExerciseProgressSection offline", () => {
  it("C11: con l'elenco esercizi in cache e la progressione in pausa, il messaggio sta nella card e il selettore resta", () => {
    vi.mocked(usePerformedExercises).mockReturnValue({
      data: [{ exercise_id: 2, name: "Panca", tracking: "weight_reps", custom: false, last_date: "2026-09-20" }],
      isLoading: false,
      isError: false,
      fetchStatus: "idle",
    } as unknown as ReturnType<typeof usePerformedExercises>);
    vi.mocked(useExerciseProgress).mockReturnValue(pausedQuery() as unknown as ReturnType<typeof useExerciseProgress>);

    render(
      <MemoryRouter>
        <ExerciseProgressSection period={period} enabled />
      </MemoryRouter>,
    );

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Esercizio" })).toBeInTheDocument();
    expect(screen.queryByText("Caricamento progressione...")).not.toBeInTheDocument();
  });
});
