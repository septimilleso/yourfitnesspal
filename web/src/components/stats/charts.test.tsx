import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GymStats } from "../../api/gym";
import type { WeightDay } from "../../api/weights";
import type { ChartPoint } from "../../lib/stats";
import GymSummaryCard from "./GymSummaryCard";
import KcalChart from "./KcalChart";
import WeeklyFrequencyChart from "./WeeklyFrequencyChart";
import ProgressChart from "./ProgressChart";
import MacroChart from "./MacroChart";
import MacroSplitBars from "./MacroSplitBars";
import SummaryTable from "./SummaryTable";
import WeightChart from "./WeightChart";

function point(key: string, kcal: number, logged = kcal > 0): ChartPoint {
  return { key, label: key.slice(5), kcal, protein_g: 100, carbs_g: 200, fat_g: 50, logged };
}

const points = [point("2026-09-01", 1800), point("2026-09-02", 0), point("2026-09-03", 2400)];

function weightDay(date: string, weight_kg: number | null, avg_7d_kg: number | null): WeightDay {
  return { date, id: weight_kg === null ? null : Number(date.slice(-2)), weight_kg, avg_7d_kg };
}

describe("WeightChart", () => {
  it("draws one point per weigh-in and a line for the moving average", () => {
    const days = [
      weightDay("2026-09-01", 70, 70),
      weightDay("2026-09-02", null, 71),
      weightDay("2026-09-03", 72, 71.5),
      weightDay("2026-09-04", 73, null),
    ];
    const { container } = render(<WeightChart days={days} />);
    expect(container.querySelectorAll('[data-testid="weight-point"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="weight-avg-line"]')).toHaveAttribute("points", expect.any(String));
    expect(screen.getAllByTestId("y-axis-label").map((label) => label.textContent)).toEqual([
      "70 kg",
      "71 kg",
      "72 kg",
      "73 kg",
    ]);
    expect(screen.getAllByTestId("y-axis-label")[0]).toHaveAttribute("font-size", "13");
    expect(container.querySelectorAll('[data-testid="chart-gridline"]')).toHaveLength(4);
  });
});

describe("ProgressChart", () => {
  it("draws one point per session", () => {
    const { container } = render(
      <ProgressChart
        points={[
          { date: "2026-09-01", value: 100 },
          { date: "2026-09-08", value: 105 },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-testid="progress-point"]')).toHaveLength(2);
    expect(screen.getAllByTestId("y-axis-label").map((label) => label.textContent)).toEqual([
      "100 kg",
      "102 kg",
      "104 kg",
      "106 kg",
    ]);
  });

  it("uses compact labels for large load and volume values", () => {
    render(
      <ProgressChart
        metric="volume_kg"
        points={[
          { date: "2026-09-01", value: 10000 },
          { date: "2026-09-08", value: 20000 },
        ]}
      />,
    );
    expect(screen.getAllByTestId("y-axis-label").map((label) => label.textContent)).toEqual([
      "10k kg",
      "12,5k kg",
      "15k kg",
      "17,5k kg",
      "20k kg",
    ]);
  });

  it("formats integer reps and long durations in minutes", () => {
    const { rerender } = render(
      <ProgressChart
        metric="max_reps"
        points={[
          { date: "2026-09-01", value: 8 },
          { date: "2026-09-08", value: 12 },
        ]}
      />,
    );
    expect(screen.getAllByTestId("y-axis-label").map((label) => label.textContent)).toEqual([
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);

    rerender(
      <ProgressChart
        metric="max_duration_s"
        points={[
          { date: "2026-09-01", value: 120 },
          { date: "2026-09-08", value: 180 },
        ]}
      />,
    );
    expect(screen.getAllByTestId("y-axis-label").map((label) => label.textContent)).toEqual([
      "2 min",
      "2,25 min",
      "2,5 min",
      "2,75 min",
      "3 min",
    ]);
  });
});

describe("WeeklyFrequencyChart", () => {
  it("draws one bar per week, including weeks with no workouts", () => {
    const { container } = render(
      <WeeklyFrequencyChart
        weeks={[
          { week_start: "2026-09-14", workouts: 2 },
          { week_start: "2026-09-21", workouts: 0 },
        ]}
      />,
    );
    expect(container.querySelectorAll('[data-testid="frequency-bar"]')).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Frequenza settimanale" })).toBeInTheDocument();
    expect(screen.getAllByTestId("y-axis-label").map((label) => label.textContent)).toEqual(["0", "1", "2"]);
  });
});

describe("GymSummaryCard", () => {
  const stats: GymStats = {
    start: "2026-09-19",
    end: "2026-09-25",
    workouts: 2,
    volume_kg: 1234.5,
    avg_duration_min: 45,
    weeks: [],
  };

  it("renders period totals", () => {
    render(<GymSummaryCard stats={stats} />);
    expect(screen.getByText("2", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("1.234,5 kg")).toBeInTheDocument();
    expect(screen.getByText("45 min")).toBeInTheDocument();
  });

  it("shows zero values and an empty-period message", () => {
    render(<GymSummaryCard stats={{ ...stats, workouts: 0, volume_kg: 0, avg_duration_min: null }} />);
    expect(screen.getByText("Nessun allenamento nel periodo")).toBeInTheDocument();
    expect(screen.getByText("0 kg")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("KcalChart", () => {
  it("draws one bar per logged point, colored against the goal, and the goal line", () => {
    const { container } = render(<KcalChart points={points} goalKcal={2000} />);
    const bars = container.querySelectorAll('[data-testid="kcal-bar"]');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute("fill", "#16a34a");
    expect(bars[1]).toHaveAttribute("fill", "#dc2626");
    expect(container.querySelector('[data-testid="goal-line"]')).not.toBeNull();
    expect(screen.getByText("Obiettivo 2000 kcal")).toBeInTheDocument();
    expect(screen.getAllByTestId("y-axis-label").map((label) => label.textContent)).toEqual([
      "0 kcal",
      "1.000 kcal",
      "2.000 kcal",
      "3.000 kcal",
    ]);
  });

  it("omits the goal line without a goal", () => {
    const { container } = render(<KcalChart points={points} goalKcal={null} />);
    expect(container.querySelector('[data-testid="goal-line"]')).toBeNull();
  });

  it("shows an empty state", () => {
    render(<KcalChart points={[point("2026-09-01", 0)]} goalKcal={2000} />);
    expect(screen.getByText("Nessun dato nel periodo")).toBeInTheDocument();
  });
});

describe("MacroChart", () => {
  it("stacks three segments per logged point and shows a legend", () => {
    const { container } = render(<MacroChart points={points} />);
    expect(container.querySelectorAll('[data-testid="macro-segment"]')).toHaveLength(6);
    expect(screen.getByText("Proteine")).toBeInTheDocument();
    expect(screen.getByText("Carboidrati")).toBeInTheDocument();
    expect(screen.getByText("Grassi")).toBeInTheDocument();
    expect(screen.getAllByTestId("y-axis-label").map((label) => label.textContent)).toEqual([
      "0 g",
      "100 g",
      "200 g",
      "300 g",
      "400 g",
    ]);
  });
});

describe("MacroSplitBars", () => {
  it("shows consumed and target rows", () => {
    render(
      <MacroSplitBars
        consumed={{ protein: 30, carbs: 40, fat: 30 }}
        target={{ protein: 27, carbs: 45, fat: 28 }}
      />,
    );
    const consumed = screen.getByRole("group", { name: "Consumato" });
    expect(within(consumed).getByText("30%", { selector: "[data-macro=protein]" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Obiettivo" })).toBeInTheDocument();
  });

  it("hides the target row without a goal and shows empty state without data", () => {
    const { rerender } = render(<MacroSplitBars consumed={{ protein: 30, carbs: 40, fat: 30 }} target={null} />);
    expect(screen.queryByRole("group", { name: "Obiettivo" })).not.toBeInTheDocument();
    rerender(<MacroSplitBars consumed={null} target={null} />);
    expect(screen.getByText("Nessun dato nel periodo")).toBeInTheDocument();
  });
});

describe("SummaryTable", () => {
  it("renders averages and counts", () => {
    render(
      <SummaryTable
        summary={{
          totalDays: 7,
          loggedDays: 5,
          averages: { kcal: 1950, protein_g: 120, carbs_g: 210, fat_g: 65 },
          daysOverGoal: 2,
        }}
      />,
    );
    expect(screen.getByText("1950 kcal")).toBeInTheDocument();
    expect(screen.getByText("120 g")).toBeInTheDocument();
    expect(screen.getByText("5 / 7")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("uses dashes without data or goal", () => {
    render(<SummaryTable summary={{ totalDays: 7, loggedDays: 0, averages: null, daysOverGoal: null }} />);
    expect(screen.getAllByText("–")).toHaveLength(5);
  });
});
