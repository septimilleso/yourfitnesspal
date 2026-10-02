import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryItem } from "../../api/gym";
import { useHistory } from "../../api/gym";
import { monthLabel } from "../../lib/gym";
import HistoryPage from "./HistoryPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useHistory: vi.fn() };
});

vi.mock("../../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));

const workouts: HistoryItem[] = [
  {
    id: 9,
    name: "Giorno 1",
    started_at: "2026-10-02T18:00:00Z",
    finished_at: "2026-10-02T19:00:00Z",
    exercises: [{ name: "Squat", sets: 3 }],
  },
  {
    id: 8,
    name: "Giorno 2",
    started_at: "2026-10-01T18:00:00Z",
    finished_at: "2026-10-01T19:00:00Z",
    exercises: [{ name: "Panca", sets: 4 }],
  },
  {
    id: 7,
    name: "Giorno 3",
    started_at: "2026-09-24T18:00:00Z",
    finished_at: "2026-09-24T19:00:00Z",
    exercises: [{ name: "Stacco", sets: 2 }],
  },
];

const fetchNextPage = vi.fn();

function mockHistory(items: HistoryItem[], hasNextPage = false) {
  vi.mocked(useHistory).mockReturnValue({
    data: { pages: [{ items, next_before: null }], pageParams: [null] },
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useHistory>);
}

function renderHistory(items: HistoryItem[], hasNextPage = false) {
  mockHistory(items, hasNextPage);
  return render(
    <MemoryRouter initialEntries={["/gym/history"]}>
      <Routes>
        <Route path="/gym/history" element={<HistoryPage />} />
        <Route path="/gym/history/:id" element={<p>Pagina allenamento</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HistoryPage", () => {
  beforeEach(() => {
    fetchNextPage.mockReset();
  });

  it("groups workouts by month and preserves the received order", () => {
    renderHistory(workouts, true);

    const monthHeadings = screen.getAllByRole("heading", { level: 2 });
    expect(monthHeadings).toHaveLength(2);
    expect(monthHeadings.map((heading) => heading.textContent)).toEqual([
      monthLabel(workouts[0].finished_at),
      monthLabel(workouts[2].finished_at),
    ]);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/gym/history/9",
      "/gym/history/8",
      "/gym/history/7",
    ]);
    expect(links[0]).toHaveTextContent("Giorno 1");
    expect(links[1]).toHaveTextContent("Giorno 2");
    expect(links[2]).toHaveTextContent("Giorno 3");
  });

  it("opens a workout detail when its card link is clicked", async () => {
    const user = userEvent.setup();
    renderHistory(workouts);

    await user.click(screen.getByRole("link", { name: /Giorno 1/ }));

    expect(screen.getByText("Pagina allenamento")).toBeInTheDocument();
  });

  it("loads the next page when requested", async () => {
    const user = userEvent.setup();
    renderHistory(workouts, true);

    await user.click(screen.getByRole("button", { name: "Carica altri" }));

    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it("does not show the load-more button when there is no next page", () => {
    renderHistory(workouts);

    expect(screen.queryByRole("button", { name: "Carica altri" })).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no completed workouts", () => {
    renderHistory([]);

    expect(screen.getByText("Nessun allenamento completato.")).toBeInTheDocument();
  });
});
