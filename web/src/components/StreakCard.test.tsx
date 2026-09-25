import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useStreak } from "../api/queries";
import StreakCard from "./StreakCard";

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return { ...actual, useStreak: vi.fn() };
});

function mockStreak(value: Partial<ReturnType<typeof useStreak>>) {
  vi.mocked(useStreak).mockReturnValue({ isLoading: false, isError: false, ...value } as ReturnType<typeof useStreak>);
}

describe("StreakCard", () => {
  it("shows the current run and the record", () => {
    mockStreak({ data: { current: 5, best: 12 } });
    render(<StreakCard />);
    expect(screen.getByText("5 giorni di fila")).toBeInTheDocument();
    expect(screen.getByText("Record: 12")).toBeInTheDocument();
  });

  it("uses the singular for one day", () => {
    mockStreak({ data: { current: 1, best: 1 } });
    render(<StreakCard />);
    expect(screen.getByText("1 giorno di fila")).toBeInTheDocument();
  });

  it("invites to start a run at zero", () => {
    mockStreak({ data: { current: 0, best: 4 } });
    render(<StreakCard />);
    expect(screen.getByText("Inizia oggi la tua serie")).toBeInTheDocument();
  });

  it("shows an error message", () => {
    mockStreak({ isError: true });
    render(<StreakCard />);
    expect(screen.getByText("Impossibile caricare la serie.")).toBeInTheDocument();
  });
});
