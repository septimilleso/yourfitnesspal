import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useGymCount } from "../api/gym";
import WorkoutCountCard from "./WorkoutCountCard";

vi.mock("../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../api/gym")>("../api/gym");
  return { ...actual, useGymCount: vi.fn() };
});

function mockCount(value: Partial<ReturnType<typeof useGymCount>>) {
  vi.mocked(useGymCount).mockReturnValue({ isLoading: false, isError: false, ...value } as ReturnType<typeof useGymCount>);
}

describe("WorkoutCountCard", () => {
  it("shows the count and workout badge progress", () => {
    mockCount({ data: { finished: 23 } });

    render(<WorkoutCountCard />);

    expect(screen.getByText("23 allenamenti")).toBeInTheDocument();
    expect(screen.getByText("Badge 2 / 30")).toBeInTheDocument();
    expect(screen.getByText("Prossimo badge tra 7 allenamenti")).toBeInTheDocument();
    expect(screen.queryByText(/di fila/)).not.toBeInTheDocument();
  });

  it("uses the singular for one workout", () => {
    mockCount({ data: { finished: 1 } });

    render(<WorkoutCountCard />);

    expect(screen.getByText("1 allenamento")).toBeInTheDocument();
  });

  it("shows the first badge milestone at zero workouts", () => {
    mockCount({ data: { finished: 0 } });

    render(<WorkoutCountCard />);

    expect(screen.getByText("Primo badge a 10 allenamenti")).toBeInTheDocument();
  });

  it.each([300, 350])("shows the complete collection at %i workouts", (finished) => {
    mockCount({ data: { finished } });

    render(<WorkoutCountCard />);

    expect(screen.getByText("Collezione completa!")).toBeInTheDocument();
  });

  it("shows an error message without the badge grid", () => {
    mockCount({ isError: true });

    render(<WorkoutCountCard />);

    expect(screen.getByText("Impossibile caricare gli allenamenti.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
