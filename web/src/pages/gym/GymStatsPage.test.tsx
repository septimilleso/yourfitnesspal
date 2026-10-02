import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  useExerciseProgress,
  useGymStats,
  usePerformedExercises,
  type ExerciseProgress,
  type GymStats,
  type PerformedExercise,
} from "../../api/gym";
import { todayIso } from "../../lib/date";
import GymStatsPage from "./GymStatsPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return {
    ...actual,
    useGymStats: vi.fn(),
    usePerformedExercises: vi.fn(),
    useExerciseProgress: vi.fn(),
  };
});
vi.mock("../../lib/date", async () => {
  const actual = await vi.importActual<typeof import("../../lib/date")>("../../lib/date");
  return { ...actual, todayIso: vi.fn(() => "2026-09-25") };
});
vi.mock("../../components/ModeSwitch", () => ({ default: () => null }));
vi.mock("../../components/WorkoutCountCard", () => ({ default: () => <div data-testid="workout-count" /> }));

function Location() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

const stats: GymStats = {
  start: "2026-09-19",
  end: "2026-09-25",
  workouts: 2,
  volume_kg: 1234.5,
  avg_duration_min: 45,
  weeks: [
    { week_start: "2026-09-14", workouts: 1 },
    { week_start: "2026-09-21", workouts: 1 },
  ],
};

const exercises: PerformedExercise[] = [
  { exercise_id: 2, name: "Panca", tracking: "weight_reps", custom: false, last_date: "2026-09-20" },
  { exercise_id: 1, name: "Squat", tracking: "duration", custom: false, last_date: "2026-09-18" },
];

const progress: ExerciseProgress = {
  exercise_id: 2,
  name: "Panca",
  tracking: "weight_reps",
  start: "2026-09-19",
  end: "2026-09-25",
  sessions: [
    {
      date: "2026-09-20",
      workout_id: 9,
      metrics: { max_weight_kg: 100, max_1rm_kg: 116.7, volume_kg: 500 },
      sets: ["100 kg × 5"],
    },
  ],
  records: [
    { kind: "max_weight_kg", value: 100, date: "2026-09-20" },
    { kind: "max_1rm_kg", value: 116.7, date: "2026-09-20" },
  ],
};

function renderAt(path = "/gym/stats") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GymStatsPage />
      <Location />
    </MemoryRouter>,
  );
}

function mockStats(data: GymStats | undefined, options: { isLoading?: boolean; isError?: boolean } = {}) {
  vi.mocked(useGymStats).mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
  } as ReturnType<typeof useGymStats>);
}

function mockPerformedExercises(data: PerformedExercise[], options: { isLoading?: boolean; isError?: boolean } = {}) {
  vi.mocked(usePerformedExercises).mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
  } as ReturnType<typeof usePerformedExercises>);
}

function mockExerciseProgress(
  data: ExerciseProgress | undefined,
  options: { isLoading?: boolean; isError?: boolean } = {},
) {
  vi.mocked(useExerciseProgress).mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
  } as ReturnType<typeof useExerciseProgress>);
}

describe("GymStatsPage", () => {
  beforeEach(() => {
    vi.mocked(todayIso).mockReturnValue("2026-09-25");
    mockStats(stats);
    mockPerformedExercises(exercises);
    mockExerciseProgress(progress);
  });

  it("loads the last 7 days by default", () => {
    renderAt();
    expect(useGymStats).toHaveBeenLastCalledWith("2026-09-19", "2026-09-25", true);
    expect(screen.getByRole("button", { name: "7 giorni" })).toHaveAttribute("aria-pressed", "true");
  });

  it("changes preset and updates the query string", async () => {
    const user = userEvent.setup();
    renderAt("/gym/stats?exercise=12&range=7");
    await user.click(screen.getByRole("button", { name: "30 giorni" }));
    expect(useGymStats).toHaveBeenLastCalledWith("2026-08-27", "2026-09-25", true);
    expect(new URLSearchParams(screen.getByTestId("location-search").textContent).get("range")).toBe("30");
    expect(new URLSearchParams(screen.getByTestId("location-search").textContent).get("exercise")).toBe("12");
  });

  it("uses a custom range from the query string", () => {
    renderAt("/gym/stats?from=2026-09-01&to=2026-09-10&exercise=12");
    expect(useGymStats).toHaveBeenLastCalledWith("2026-09-01", "2026-09-10", true);
    expect(screen.getByLabelText("Dal")).toHaveValue("2026-09-01");
  });

  it("does not request an invalid custom range", () => {
    renderAt("/gym/stats?from=2026-09-10&to=2026-09-01");
    expect(screen.getByRole("alert")).toHaveTextContent("La data iniziale deve precedere quella finale.");
    expect(vi.mocked(useGymStats).mock.lastCall?.[2]).toBe(false);
    expect(screen.queryByText("Allenamenti")).not.toBeInTheDocument();
  });

  it("renders the summary and one bar for each week", () => {
    const { container } = renderAt();
    expect(screen.getByText("2", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("1.234,5 kg")).toBeInTheDocument();
    expect(screen.getByText("45 min")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="frequency-bar"]')).toHaveLength(2);
  });

  it("shows the empty period state", () => {
    mockStats({ ...stats, workouts: 0, volume_kg: 0, avg_duration_min: null, weeks: [] });
    renderAt();
    expect(screen.getByText("Nessun allenamento nel periodo")).toBeInTheDocument();
  });

  it("keeps the workout count card visible when period statistics fail", () => {
    mockStats(undefined, { isError: true });
    renderAt();
    expect(screen.getByText("Impossibile caricare le statistiche.")).toBeInTheDocument();
    expect(screen.getByTestId("workout-count")).toBeInTheDocument();
  });

  it("selects the most recent exercise and preserves the period in the query string", async () => {
    const user = userEvent.setup();
    renderAt("/gym/stats?range=30");
    expect(screen.getByLabelText("Esercizio")).toHaveValue("2");
    await user.selectOptions(screen.getByLabelText("Esercizio"), "1");
    expect(new URLSearchParams(screen.getByTestId("location-search").textContent)).toEqual(
      new URLSearchParams("range=30&exercise=1"),
    );
    expect(useExerciseProgress).toHaveBeenLastCalledWith(1, "2026-08-27", "2026-09-25", true);
  });

  it("shows weight progress, formatted session sets and personal records", () => {
    renderAt();
    expect(screen.getByRole("button", { name: "Carico max" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1RM stimato" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volume" })).toBeInTheDocument();
    expect(screen.getByText("100 kg × 5")).toBeInTheDocument();
    expect(screen.getByText("Carico massimo")).toBeInTheDocument();
    expect(screen.getByText("100 kg")).toBeInTheDocument();
    expect(screen.getAllByText(/20 settembre/i).length).toBeGreaterThan(0);
  });

  it("shows duration metrics for duration exercises", () => {
    mockExerciseProgress({
      ...progress,
      exercise_id: 1,
      name: "Squat",
      tracking: "duration",
      sessions: [{ date: "2026-09-18", workout_id: 8, metrics: { max_duration_s: 60, total_duration_s: 120 }, sets: ["60 s"] }],
      records: [{ kind: "max_duration_s", value: 60, date: "2026-09-18" }],
    });
    renderAt("/gym/stats?exercise=1");
    expect(screen.getByRole("button", { name: "Durata max" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Durata totale" })).toBeInTheDocument();
  });

  it("shows an empty progress message when the user has no performed exercises", () => {
    mockPerformedExercises([]);
    renderAt();
    expect(screen.getByText("Completa un allenamento per vedere i progressi")).toBeInTheDocument();
    expect(screen.queryByLabelText("Esercizio")).not.toBeInTheDocument();
  });

  it("shows a progress error without hiding the summary", () => {
    mockExerciseProgress(undefined, { isError: true });
    renderAt();
    expect(screen.getByText("Impossibile caricare la progressione.")).toBeInTheDocument();
    expect(screen.getByText("1.234,5 kg")).toBeInTheDocument();
  });
});
