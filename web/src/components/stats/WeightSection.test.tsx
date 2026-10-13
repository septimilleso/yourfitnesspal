import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDeleteWeight, useWeightHistory, type WeightDay, type WeightHistory } from "../../api/weights";
import WeightSection from "./WeightSection";

vi.mock("../../api/weights", async () => {
  const actual = await vi.importActual<typeof import("../../api/weights")>("../../api/weights");
  return { ...actual, useWeightHistory: vi.fn(), useDeleteWeight: vi.fn() };
});

const period = { start: "2026-09-19", end: "2026-09-25" };

function weightHistory(days: WeightDay[]): WeightHistory {
  return { start: period.start, end: period.end, days, weeks: [] };
}

function mockHistory(value: Partial<ReturnType<typeof useWeightHistory>>) {
  vi.mocked(useWeightHistory).mockReturnValue({ isLoading: false, isError: false, ...value } as ReturnType<typeof useWeightHistory>);
}

describe("WeightSection", () => {
  beforeEach(() => {
    vi.mocked(useDeleteWeight).mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<typeof useDeleteWeight>);
  });

  it("shows a loading message while the history loads", () => {
    mockHistory({ isLoading: true });
    render(<WeightSection period={period} enabled />);
    expect(screen.getByText("Caricamento...")).toBeInTheDocument();
  });

  it("shows an error message when the history fails", () => {
    mockHistory({ isError: true });
    render(<WeightSection period={period} enabled />);
    expect(screen.getByText("Impossibile caricare il peso.")).toBeInTheDocument();
  });

  it("shows the empty message when the period has no weigh-ins", () => {
    mockHistory({ data: weightHistory([]) });
    render(<WeightSection period={period} enabled />);
    expect(screen.getByText("Nessuna pesata nel periodo")).toBeInTheDocument();
  });

  it("lists a weigh-in with its weight in kg", () => {
    mockHistory({ data: weightHistory([{ date: "2026-09-22", id: 5, weight_kg: 72.5, avg_7d_kg: 72.5 }]) });
    render(<WeightSection period={period} enabled />);
    const list = screen.getByRole("list");
    expect(within(list).getByText("72,5 kg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Elimina pesata del / })).toBeInTheDocument();
  });

  it("renders nothing when disabled", () => {
    mockHistory({ isError: true });
    const { container } = render(<WeightSection period={period} enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
