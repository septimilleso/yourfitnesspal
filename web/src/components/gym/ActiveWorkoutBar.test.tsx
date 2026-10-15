import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useActiveWorkout } from "../../api/gym";
import { liveWorkout } from "../../test/liveSession";
import ActiveWorkoutBar from "./ActiveWorkoutBar";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useActiveWorkout: vi.fn() };
});

const NOW = Date.parse("2026-09-24T18:00:00Z");

function renderBar() {
  return render(
    <MemoryRouter>
      <ActiveWorkoutBar />
    </MemoryRouter>,
  );
}

describe("ActiveWorkoutBar", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing without a live workout", () => {
    vi.mocked(useActiveWorkout).mockReturnValue({ data: null } as unknown as ReturnType<typeof useActiveWorkout>);
    const { container } = renderBar();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the live workout name and elapsed time, linking back to the session", () => {
    vi.mocked(useActiveWorkout).mockReturnValue({
      data: liveWorkout([], { started_at: new Date(NOW - 125_000).toISOString() }),
    } as unknown as ReturnType<typeof useActiveWorkout>);

    renderBar();

    const link = screen.getByRole("link", { name: /Allenamento in corso · Giorno 1/ });
    expect(link).toHaveAttribute("href", "/gym/workout");
    expect(link).toHaveTextContent("2:05");
  });
});
