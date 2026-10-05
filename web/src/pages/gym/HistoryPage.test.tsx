import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryItem } from "../../api/gym";
import { useDeleteWorkout, useHistory } from "../../api/gym";
import { monthLabel } from "../../lib/gym";
import HistoryPage from "./HistoryPage";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useHistory: vi.fn(), useDeleteWorkout: vi.fn() };
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
const deleteWorkout = vi.fn();
let deletePending = false;

function mockHistory(items: HistoryItem[], hasNextPage = false) {
  vi.mocked(useHistory).mockReturnValue({
    data: { pages: [{ items, next_before: null }], pageParams: [null] },
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useHistory>);
  vi.mocked(useDeleteWorkout).mockReturnValue({
    mutate: deleteWorkout,
    get isPending() {
      return deletePending;
    },
  } as unknown as ReturnType<typeof useDeleteWorkout>);
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

function swipe(element: HTMLElement, startX: number, startY: number, endX: number, endY: number) {
  fireEvent.touchStart(element, { touches: [{ clientX: startX, clientY: startY }] });
  fireEvent.touchMove(element, { touches: [{ clientX: endX, clientY: endY }] });
  fireEvent.touchEnd(element, {
    touches: [],
    changedTouches: [{ clientX: endX, clientY: endY }],
  });
}

describe("HistoryPage", () => {
  beforeEach(() => {
    fetchNextPage.mockReset();
    deleteWorkout.mockReset();
    deletePending = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("keeps the delete action hidden and inaccessible while a card is closed", () => {
    renderHistory(workouts);

    const deleteButton = screen.getAllByText("Elimina")[0].closest("button");
    expect(deleteButton).toHaveAttribute("aria-hidden", "true");
    expect(deleteButton).toHaveAttribute("tabindex", "-1");
    expect(deleteButton).toHaveClass("pointer-events-none", "opacity-0");
    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("resets an interrupted drag on touch cancel", () => {
    renderHistory(workouts);
    const link = screen.getByRole("link", { name: /Giorno 1/ });

    fireEvent.touchStart(link, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchMove(link, { touches: [{ clientX: 100, clientY: 100 }] });
    const slidingContent = link.parentElement;
    expect(slidingContent).toHaveStyle({ transform: "translateX(-88px)" });

    fireEvent.touchCancel(link, { touches: [] });

    expect(slidingContent).toHaveStyle({ transform: "translateX(0px)" });
    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("does not start a second delete while a delete is pending", () => {
    renderHistory(workouts);
    swipe(screen.getByRole("link", { name: /Giorno 1/ }), 200, 100, 100, 100);
    deletePending = true;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    fireEvent.click(screen.getByRole("button", { name: "Elimina" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(deleteWorkout).not.toHaveBeenCalled();
  });

  it("deletes the swiped workout after confirmation and closes it on success", () => {
    renderHistory(workouts);
    const link = screen.getByRole("link", { name: /Giorno 1/ });
    swipe(link, 200, 100, 100, 100);

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Elimina" }));

    expect(confirm).toHaveBeenCalledWith("Eliminare questo allenamento dallo storico?");
    expect(deleteWorkout).toHaveBeenCalledOnce();
    expect(deleteWorkout.mock.calls[0][0]).toBe(9);
    expect(screen.getByRole("button", { name: "Elimina" })).toBeInTheDocument();

    const callbacks = deleteWorkout.mock.calls[0][1] as { onSuccess?: () => void };
    act(() => callbacks.onSuccess?.());
    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("does not delete when confirmation is canceled and closes the card", () => {
    renderHistory(workouts);
    swipe(screen.getByRole("link", { name: /Giorno 1/ }), 200, 100, 100, 100);

    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Elimina" }));

    expect(deleteWorkout).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("shows a delete error and keeps the workout card open", () => {
    renderHistory(workouts);
    swipe(screen.getByRole("link", { name: /Giorno 1/ }), 200, 100, 100, 100);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Elimina" }));
    const callbacks = deleteWorkout.mock.calls[0][1] as { onError?: () => void };
    act(() => callbacks.onError?.());

    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent("Impossibile eliminare l'allenamento.");
    expect(error.closest("[data-swipeable-id]")).toHaveAttribute("data-swipeable-id", "9");
    expect(screen.getByRole("link", { name: /Giorno 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elimina" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Giorno 1/ }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not open the delete action for a predominantly vertical gesture", () => {
    renderHistory(workouts);
    swipe(screen.getByRole("link", { name: /Giorno 1/ }), 200, 100, 170, 220);

    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("closes the previously opened card when another card is swiped", () => {
    renderHistory(workouts);
    swipe(screen.getByRole("link", { name: /Giorno 1/ }), 200, 100, 100, 100);
    expect(screen.getByRole("button", { name: "Elimina" })).toBeInTheDocument();

    swipe(screen.getByRole("link", { name: /Giorno 2/ }), 200, 100, 100, 100);

    expect(screen.getAllByRole("button", { name: "Elimina" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Giorno 2/ }).closest("[data-swipeable-id]")).toHaveAttribute(
      "data-swipeable-id",
      "8",
    );
  });

  it("closes an open card after a right swipe", () => {
    renderHistory(workouts);
    const link = screen.getByRole("link", { name: /Giorno 1/ });
    swipe(link, 200, 100, 100, 100);
    swipe(link, 200, 100, 250, 100);

    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("does not follow the detail link after a short horizontal drag", () => {
    renderHistory(workouts);
    const link = screen.getByRole("link", { name: /Giorno 1/ });
    swipe(link, 200, 100, 170, 100);

    fireEvent.click(link);

    expect(screen.queryByText("Pagina allenamento")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("closes an open card on tap without navigating to its detail", () => {
    renderHistory(workouts);
    const link = screen.getByRole("link", { name: /Giorno 1/ });
    swipe(link, 200, 100, 100, 100);

    fireEvent.click(link);

    expect(screen.queryByText("Pagina allenamento")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("ignores a swipe that starts at the left screen edge", () => {
    renderHistory(workouts);
    swipe(screen.getByRole("link", { name: /Giorno 1/ }), 10, 100, -90, 100);

    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });

  it("closes an open card when a pointer starts outside it", () => {
    renderHistory(workouts);
    swipe(screen.getByRole("link", { name: /Giorno 1/ }), 200, 100, 100, 100);

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("button", { name: "Elimina" })).not.toBeInTheDocument();
  });
});
