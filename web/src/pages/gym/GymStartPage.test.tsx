import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useActiveWorkout,
  useCreateFolder,
  useDeleteFolder,
  useDeleteTemplate,
  useDuplicateTemplate,
  usePatchTemplate,
  useRenameFolder,
  useStartWorkout,
  useTemplate,
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
    useTemplate: vi.fn(),
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

// Con le rotte di uscita, per vedere dove porta l'avvio.
function renderWithSession() {
  return render(
    <MemoryRouter initialEntries={["/gym"]}>
      <Routes>
        <Route path="/gym" element={<GymStartPage />} />
        <Route path="/gym/workout" element={<div>live session page</div>} />
      </Routes>
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

  describe("starting a workout", () => {
    afterEach(() => vi.restoreAllMocks());

    function startMutation() {
      const start = vi.fn((_templateId: number | null, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
      vi.mocked(useStartWorkout).mockReturnValue({ mutate: start, isPending: false } as unknown as ReturnType<typeof useStartWorkout>);
      return start;
    }

    it("starts an empty workout and opens the live session", async () => {
      const start = startMutation();
      renderWithSession();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Inizia un allenamento vuoto" }));

      expect(start).toHaveBeenCalledWith(null, expect.anything());
      expect(await screen.findByText("live session page")).toBeInTheDocument();
    });

    it("starts from a template picked in the preview", async () => {
      const start = startMutation();
      mockTemplates({ data: { folders: [], templates: [pushTemplate] } });
      vi.mocked(useTemplate).mockReturnValue({
        data: { id: 1, name: "Push A", exercises: [] },
        isLoading: false,
        isError: false,
      } as unknown as ReturnType<typeof useTemplate>);
      renderWithSession();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Push A" }));
      await user.click(screen.getByRole("button", { name: "Inizia allenamento" }));

      expect(start).toHaveBeenCalledWith(1, expect.anything());
      expect(await screen.findByText("live session page")).toBeInTheDocument();
    });

    it("resumes the running workout after confirmation, without starting another", async () => {
      const start = startMutation();
      vi.mocked(useActiveWorkout).mockReturnValue({ data: { id: 3 }, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWithSession();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Riprendi allenamento" }));

      expect(confirm).toHaveBeenCalledWith("C'è già un allenamento in corso. Vuoi riprenderlo?");
      expect(start).not.toHaveBeenCalled();
      expect(await screen.findByText("live session page")).toBeInTheDocument();
    });

    it("stays on the start page when resuming is not confirmed", async () => {
      const start = startMutation();
      vi.mocked(useActiveWorkout).mockReturnValue({ data: { id: 3 }, isLoading: false, isError: false } as unknown as ReturnType<typeof useActiveWorkout>);
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderWithSession();
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Riprendi allenamento" }));

      expect(start).not.toHaveBeenCalled();
      expect(screen.queryByText("live session page")).not.toBeInTheDocument();
    });
  });
});
