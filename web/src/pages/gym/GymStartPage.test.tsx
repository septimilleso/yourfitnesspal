import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useActiveWorkout,
  useCreateFolder,
  useDeleteFolder,
  useDeleteTemplate,
  useDuplicateTemplate,
  usePatchTemplate,
  useRenameFolder,
  useStartWorkout,
  useTemplates,
  type TemplateSummary,
  type TemplatesResponse,
} from "../../api/gym";
import GymStartPage from "./GymStartPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useTemplates: vi.fn(),
    useActiveWorkout: vi.fn(),
    useStartWorkout: vi.fn(),
    useCreateFolder: vi.fn(),
    useRenameFolder: vi.fn(),
    useDeleteFolder: vi.fn(),
    useDuplicateTemplate: vi.fn(),
    useDeleteTemplate: vi.fn(),
    usePatchTemplate: vi.fn(),
  };
});
vi.mock("../../components/ModeSwitch", () => ({ default: () => null }));

const emptyList: TemplatesResponse = { folders: [], templates: [] };

const pushTemplate: TemplateSummary = {
  id: 1,
  name: "Push A",
  folder_id: null,
  last_used_at: null,
  exercise_names: ["Panca piana"],
};

function mockTemplates(value: Partial<ReturnType<typeof useTemplates>>) {
  vi.mocked(useTemplates).mockReturnValue({ isLoading: false, isError: false, ...value } as ReturnType<typeof useTemplates>);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <GymStartPage />
    </MemoryRouter>,
  );
}

describe("GymStartPage", () => {
  beforeEach(() => {
    const mutation = { mutate: vi.fn(), isPending: false };
    mockTemplates({ data: emptyList });
    vi.mocked(useActiveWorkout).mockReturnValue({ data: undefined, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
    vi.mocked(useStartWorkout).mockReturnValue(mutation as unknown as ReturnType<typeof useStartWorkout>);
    vi.mocked(useCreateFolder).mockReturnValue(mutation as unknown as ReturnType<typeof useCreateFolder>);
    vi.mocked(useRenameFolder).mockReturnValue(mutation as unknown as ReturnType<typeof useRenameFolder>);
    vi.mocked(useDeleteFolder).mockReturnValue(mutation as unknown as ReturnType<typeof useDeleteFolder>);
    vi.mocked(useDuplicateTemplate).mockReturnValue(mutation as unknown as ReturnType<typeof useDuplicateTemplate>);
    vi.mocked(useDeleteTemplate).mockReturnValue(mutation as unknown as ReturnType<typeof useDeleteTemplate>);
    vi.mocked(usePatchTemplate).mockReturnValue(mutation as unknown as ReturnType<typeof usePatchTemplate>);
  });

  it("shows a loading message while the templates load", () => {
    mockTemplates({ isLoading: true });
    renderPage();
    expect(screen.getByText("Caricamento...")).toBeInTheDocument();
  });

  it("shows an error message when the templates fail", () => {
    mockTemplates({ isError: true });
    renderPage();
    expect(screen.getByText("Errore nel caricamento dei modelli.")).toBeInTheDocument();
  });

  it("shows the empty message when there are no templates", () => {
    renderPage();
    expect(screen.getByText('Nessun modello. Crea il primo con "+ Modello".')).toBeInTheDocument();
  });

  it("lists a template by name", () => {
    mockTemplates({ data: { folders: [], templates: [pushTemplate] } });
    renderPage();
    expect(screen.getByText("Push A")).toBeInTheDocument();
    expect(screen.queryByText('Nessun modello. Crea il primo con "+ Modello".')).not.toBeInTheDocument();
  });

  it("offers to resume when a workout is already in progress", () => {
    vi.mocked(useActiveWorkout).mockReturnValue({ data: { id: 3 }, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
    renderPage();
    expect(screen.getByRole("button", { name: "Riprendi allenamento" })).toBeInTheDocument();
  });
});
