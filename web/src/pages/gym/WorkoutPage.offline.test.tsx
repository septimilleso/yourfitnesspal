import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useActiveWorkout, useCancelWorkout, useFinishWorkout, useLiveMutation } from "../../api/gym";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "../../native/connectivity";
import { retryingQuery } from "../../test/offlineQuery";
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

  it("says the live workout is unavailable offline on the native platform", () => {
    reportNetworkFailure();
    renderPage();

    expect(screen.getByText("Allenamento non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Nessun allenamento in corso.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vai ai modelli" })).toHaveAttribute("href", "/gym");
  });

  it("keeps the unavailable message while the query retries offline", () => {
    reportNetworkFailure();
    vi.mocked(useActiveWorkout).mockReturnValue(retryingQuery() as unknown as ReturnType<typeof useActiveWorkout>);
    renderPage();

    expect(screen.getByText("Allenamento non disponibile offline")).toBeInTheDocument();
    expect(screen.queryByText("Caricamento...")).not.toBeInTheDocument();
  });

  it("shows the loading message while the query retries with the network back", () => {
    reportNetworkSuccess();
    vi.mocked(useActiveWorkout).mockReturnValue(retryingQuery() as unknown as ReturnType<typeof useActiveWorkout>);
    renderPage();

    expect(screen.getByText("Caricamento...")).toBeInTheDocument();
    expect(screen.queryByText("Allenamento non disponibile offline")).not.toBeInTheDocument();
  });

  it("keeps the usual message on the web platform", () => {
    platform.native = false;
    renderPage();

    expect(screen.getByText("Nessun allenamento in corso.")).toBeInTheDocument();
    expect(screen.queryByText("Allenamento non disponibile offline")).not.toBeInTheDocument();
  });
});
