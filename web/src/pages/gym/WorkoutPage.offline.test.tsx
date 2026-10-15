import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useActiveWorkout, useCancelWorkout, useFinishWorkout, useLiveMutation } from "../../api/gym";
import { createQueryClient } from "../../lib/queryClient";
import { reportNetworkFailure, resetConnectivityForTests } from "../../native/connectivity";
import { getSnapshot, removeEntry, startEmptyWorkout } from "../../native/gymStore";
import WorkoutPage from "./WorkoutPage";

const platform = vi.hoisted(() => ({ native: true }));

vi.mock("../../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useActiveWorkout: vi.fn(),
    useLiveMutation: vi.fn(),
    useFinishWorkout: vi.fn(),
    useCancelWorkout: vi.fn(),
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/gym/workout"]}>
      <Routes>
        <Route path="/gym/workout" element={<WorkoutPage />} />
        <Route path="/gym" element={<div>start page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Senza cache dell'allenamento, offline la query resta in pausa e non ha dati.
function mockPausedWorkout() {
  vi.mocked(useActiveWorkout).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    fetchStatus: "paused",
  } as unknown as ReturnType<typeof useActiveWorkout>);
}

describe("WorkoutPage offline", () => {
  beforeEach(() => {
    platform.native = true;
    mockPausedWorkout();
    vi.mocked(useLiveMutation).mockReturnValue({ mutate: vi.fn() } as unknown as ReturnType<typeof useLiveMutation>);
    vi.mocked(useFinishWorkout).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useFinishWorkout>);
    vi.mocked(useCancelWorkout).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useCancelWorkout>);
  });

  afterEach(() => {
    resetConnectivityForTests();
  });

  // Nell'IPA la pagina legge lo stato locale: il messaggio "non disponibile" non esiste più lì (C17–C21).
  describe("nell'IPA", () => {
    let queryClient: QueryClient;

    beforeEach(() => {
      // Prima del render: lo stato dei casi precedenti esce dallo store senza componenti montati.
      const active = getSnapshot().active;
      if (active !== null) removeEntry(active.workout.uuid);
      queryClient = createQueryClient(true);
      queryClient.mount();
    });

    afterEach(() => {
      queryClient.unmount();
      queryClient.clear();
    });

    function renderNativePage() {
      return render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/gym/workout"]}>
            <Routes>
              <Route path="/gym/workout" element={<WorkoutPage />} />
              <Route path="/gym" element={<div>start page</div>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    }

    it("shows the empty state offline, without the unavailable message", () => {
      reportNetworkFailure();
      renderNativePage();

      expect(screen.getByText("Nessun allenamento in corso.")).toBeInTheDocument();
      expect(screen.queryByText("Allenamento non disponibile offline")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Vai ai modelli" })).toHaveAttribute("href", "/gym");
    });

    it("shows the local workout offline, without waiting for the server", () => {
      startEmptyWorkout();
      reportNetworkFailure();
      renderNativePage();

      expect(screen.getByRole("textbox", { name: "Nome allenamento" })).toBeInTheDocument();
      expect(screen.queryByText("Allenamento non disponibile offline")).not.toBeInTheDocument();
      expect(screen.queryByText("Caricamento...")).not.toBeInTheDocument();
    });
  });

  it("keeps the usual message on the web platform", () => {
    platform.native = false;
    renderPage();

    expect(screen.getByText("Nessun allenamento in corso.")).toBeInTheDocument();
    expect(screen.queryByText("Allenamento non disponibile offline")).not.toBeInTheDocument();
  });
});
