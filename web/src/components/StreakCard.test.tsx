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
    render(<StreakCard mode="diet" />);
    expect(screen.getByText("5 giorni di fila")).toBeInTheDocument();
    expect(screen.getByText("Record: 12")).toBeInTheDocument();
  });

  it("uses the singular for one day", () => {
    mockStreak({ data: { current: 1, best: 1 } });
    render(<StreakCard mode="diet" />);
    expect(screen.getByText("1 giorno di fila")).toBeInTheDocument();
  });

  it("invites to start a run at zero", () => {
    mockStreak({ data: { current: 0, best: 4 } });
    render(<StreakCard mode="diet" />);
    expect(screen.getByText("Inizia oggi la tua serie")).toBeInTheDocument();
  });

  it("shows earned and locked diet badges for the current streak", () => {
    mockStreak({ data: { current: 12, best: 12 } });
    render(<StreakCard mode="diet" />);
    expect(screen.getByAltText("Badge 1")).toHaveAttribute("src", "/art/diet/badges/01.webp");
    expect(screen.getByAltText("Badge 2")).toBeInTheDocument();
    expect(screen.getAllByAltText(/bloccato$/)).toHaveLength(28);
    expect(screen.getByText("Badge 2 / 30")).toBeInTheDocument();
    expect(screen.getByText("Prossimo badge tra 3 giorni")).toBeInTheDocument();
  });

  it("uses the gym badge artwork in gym mode", () => {
    mockStreak({ data: { current: 5, best: 5 } });
    render(<StreakCard mode="gym" />);
    expect(screen.getByAltText("Badge 1")).toHaveAttribute("src", "/art/gym/badges/01.webp");
  });

  it("shows a complete collection at 150 days", () => {
    mockStreak({ data: { current: 150, best: 150 } });
    render(<StreakCard mode="diet" />);
    expect(screen.getByText("Collezione completa!")).toBeInTheDocument();
    expect(screen.queryAllByAltText(/bloccato$/)).toHaveLength(0);
  });

  it("shows an error message without the badge grid", () => {
    mockStreak({ isError: true });
    render(<StreakCard mode="diet" />);
    expect(screen.getByText("Impossibile caricare la serie.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
