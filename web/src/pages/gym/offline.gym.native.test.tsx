import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useActiveWorkout,
  useApplyToTemplate,
  useCreateFolder,
  useDeleteFolder,
  useDeleteTemplate,
  useDeleteWorkout,
  useDuplicateTemplate,
  useHistory,
  usePatchTemplate,
  useRenameFolder,
  useSaveAsTemplate,
  useStartWorkout,
  useTemplate,
  useTemplates,
  useWorkout,
} from "../../api/gym";
import TemplatePreviewSheet from "../../components/gym/TemplatePreviewSheet";
import { createQueryClient } from "../../lib/queryClient";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "../../native/connectivity";
import { pausedQuery, retryingQuery } from "../../test/offlineQuery";
import GymStartPage from "./GymStartPage";
import HistoryPage from "./HistoryPage";
import WorkoutDetailPage from "./WorkoutDetailPage";

vi.mock("../../native/platform", () => ({ isNative: () => true }));
vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useTemplates: vi.fn(),
    useTemplate: vi.fn(),
    useActiveWorkout: vi.fn(),
    useStartWorkout: vi.fn(),
    useCreateFolder: vi.fn(),
    useRenameFolder: vi.fn(),
    useDeleteFolder: vi.fn(),
    useDuplicateTemplate: vi.fn(),
    useDeleteTemplate: vi.fn(),
    usePatchTemplate: vi.fn(),
    useHistory: vi.fn(),
    useDeleteWorkout: vi.fn(),
    useWorkout: vi.fn(),
    useApplyToTemplate: vi.fn(),
    useSaveAsTemplate: vi.fn(),
  };
});
vi.mock("../../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));

let queryClient: QueryClient;

// Il client serve all'indicatore offline degli header (T17), che legge la QueryClient nativa.
function renderAt(path: string, route: string, element: ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pages = [
  {
    name: "GymStartPage",
    // Testi che non devono comparire: caricamento, errore ed elenco vuoto dei modelli.
    forbidden: ["Caricamento...", "Errore nel caricamento dei modelli.", 'Nessun modello. Crea il primo con "+ Modello".'],
    // Titolo e pulsanti della pagina, che devono restare visibili con il messaggio.
    kept: ["Modelli", "Inizia un allenamento vuoto", "+ Modello"],
    mockQuery: (query: object) => {
      vi.mocked(useTemplates).mockReturnValue(query as unknown as ReturnType<typeof useTemplates>);
    },
    renderPage: () => renderAt("/gym", "/gym", <GymStartPage />),
  },
  {
    name: "TemplatePreviewSheet",
    forbidden: ["Caricamento..."],
    kept: ["Modifica", "Inizia allenamento"],
    mockQuery: (query: object) => {
      vi.mocked(useTemplate).mockReturnValue(query as unknown as ReturnType<typeof useTemplate>);
    },
    renderPage: () =>
      render(
        <TemplatePreviewSheet templateId={1} starting={false} onStart={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />,
      ),
  },
  {
    name: "HistoryPage",
    forbidden: ["Caricamento...", "Errore nel caricamento dello storico.", "Nessun allenamento completato."],
    kept: ["Storico"],
    mockQuery: (query: object) => {
      vi.mocked(useHistory).mockReturnValue(query as unknown as ReturnType<typeof useHistory>);
    },
    renderPage: () => renderAt("/gym/history", "/gym/history", <HistoryPage />),
  },
  {
    name: "WorkoutDetailPage",
    forbidden: ["Caricamento...", "Allenamento non trovato."],
    kept: ["‹ Storico"],
    mockQuery: (query: object) => {
      vi.mocked(useWorkout).mockReturnValue(query as unknown as ReturnType<typeof useWorkout>);
    },
    renderPage: () => renderAt("/gym/history/9", "/gym/history/:id", <WorkoutDetailPage />),
  },
];

beforeEach(() => {
  queryClient = createQueryClient(true);
  queryClient.mount();
  reportNetworkFailure();
  const mutation = { mutate: vi.fn(), isPending: false, isSuccess: false };
  vi.mocked(useActiveWorkout).mockReturnValue({ data: undefined, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
  vi.mocked(useStartWorkout).mockReturnValue(mutation as unknown as ReturnType<typeof useStartWorkout>);
  vi.mocked(useCreateFolder).mockReturnValue(mutation as unknown as ReturnType<typeof useCreateFolder>);
  vi.mocked(useRenameFolder).mockReturnValue(mutation as unknown as ReturnType<typeof useRenameFolder>);
  vi.mocked(useDeleteFolder).mockReturnValue(mutation as unknown as ReturnType<typeof useDeleteFolder>);
  vi.mocked(useDuplicateTemplate).mockReturnValue(mutation as unknown as ReturnType<typeof useDuplicateTemplate>);
  vi.mocked(useDeleteTemplate).mockReturnValue(mutation as unknown as ReturnType<typeof useDeleteTemplate>);
  vi.mocked(usePatchTemplate).mockReturnValue(mutation as unknown as ReturnType<typeof usePatchTemplate>);
  vi.mocked(useDeleteWorkout).mockReturnValue(mutation as unknown as ReturnType<typeof useDeleteWorkout>);
  vi.mocked(useApplyToTemplate).mockReturnValue(mutation as unknown as ReturnType<typeof useApplyToTemplate>);
  vi.mocked(useSaveAsTemplate).mockReturnValue(mutation as unknown as ReturnType<typeof useSaveAsTemplate>);
});

afterEach(() => {
  queryClient.unmount();
  queryClient.clear();
  resetConnectivityForTests();
});

describe.each(pages)("$name offline", ({ forbidden, kept, mockQuery, renderPage }) => {
  it("con la query in pausa e senza dati mostra Non disponibile offline", () => {
    mockQuery(pausedQuery());

    renderPage();

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.getByText("Aprila con la rete per averla anche offline.")).toBeInTheDocument();
    for (const text of forbidden) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    for (const text of kept) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("con la query di nuovo in fetching resta Non disponibile offline e non compare Caricamento", () => {
    mockQuery(retryingQuery());

    renderPage();

    expect(screen.getByText("Non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento...")).not.toBeInTheDocument();
    for (const text of kept) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it("con la rete presente il messaggio non compare e la query in fetching mostra Caricamento", () => {
    reportNetworkSuccess();
    mockQuery(retryingQuery());

    renderPage();

    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
    expect(screen.getByText("Caricamento...")).toBeInTheDocument();
  });

  it("con la rete presente e la query in pausa il messaggio non compare", () => {
    reportNetworkSuccess();
    mockQuery(pausedQuery());

    renderPage();

    expect(screen.queryByText("Non disponibile offline")).not.toBeInTheDocument();
  });
});
