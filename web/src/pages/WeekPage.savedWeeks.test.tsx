import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Goal, WeekResponse } from "../api/queries";
import { useGoal, useWeekDiary } from "../api/queries";
import WeekPage from "./WeekPage";

const mocks = vi.hoisted(() => ({
  useHasPermission: vi.fn(),
  saveWeekMutation: vi.fn(),
  saveSuccess: false,
}));

vi.mock("../auth/AuthContext", () => ({
  useHasPermission: mocks.useHasPermission,
}));

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return {
    ...actual,
    useWeekDiary: vi.fn(),
    useGoal: vi.fn(),
  };
});

vi.mock("../api/savedWeeks", async () => {
  const actual = await vi.importActual<typeof import("../api/savedWeeks")>("../api/savedWeeks");
  return {
    ...actual,
    useSaveWeek: () => ({
      mutate: mocks.saveWeekMutation,
      isPending: false,
      isSuccess: mocks.saveSuccess,
      isError: false,
      error: null,
      reset: vi.fn(),
    }),
  };
});

function nutriments(kcal: number) {
  return {
    kcal,
    protein_g: 10,
    carbs_g: 20,
    sugars_g: 5,
    fat_g: 3,
    sat_fat_g: 1,
    fiber_g: 2,
    salt_g: 0.5,
  };
}

const weekResponse: WeekResponse = {
  start: "2026-08-24",
  end: "2026-08-30",
  days: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-08-${String(24 + index).padStart(2, "0")}`,
    total: nutriments(index === 0 ? 1800 : 0),
  })),
};

const goal: Goal = {
  id: 1,
  kcal: 2000,
  protein_g: 150,
  carbs_g: 250,
  fat_g: 70,
  valid_from: "2026-01-01",
};

function renderWeekPage(initialPath = "/week?start=2026-08-24") {
  vi.mocked(useWeekDiary).mockReturnValue({
    data: weekResponse,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useWeekDiary>);
  vi.mocked(useGoal).mockReturnValue({
    data: goal,
    isLoading: false,
    isError: false,
  } as ReturnType<typeof useGoal>);

  const queryClient = new QueryClient();
  const page = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/week" element={<WeekPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(page());
  return { ...view, rerenderPage: () => view.rerender(page()) };
}

describe("WeekPage saved-week commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveSuccess = false;
  });

  it("shows both commands with permission on a Monday and opens the save dialog", async () => {
    mocks.useHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    renderWeekPage();

    expect(screen.getByRole("link", { name: "Settimane salvate" })).toHaveAttribute("href", "/week/saved");
    await user.click(screen.getByRole("button", { name: "Salva settimana" }));
    expect(screen.getByRole("dialog", { name: "Salva settimana" })).toBeInTheDocument();
  });

  it("keeps the save dialog open to show its success message", async () => {
    mocks.useHasPermission.mockReturnValue(true);
    mocks.saveWeekMutation.mockImplementation((_input, options: { onSuccess?: () => void }) => {
      mocks.saveSuccess = true;
      options?.onSuccess?.();
    });
    const user = userEvent.setup();
    const view = renderWeekPage();

    await user.click(screen.getByRole("button", { name: "Salva settimana" }));
    await user.type(screen.getByLabelText("Nome"), "  Piano A  ");
    await user.click(screen.getByRole("button", { name: "Salva" }));
    view.rerenderPage();

    expect(screen.getByRole("dialog", { name: "Salva settimana" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Settimana salvata.");
    expect(screen.getByRole("button", { name: "Chiudi" })).toBeInTheDocument();
  });

  it("hides both commands without diary.copy permission", () => {
    mocks.useHasPermission.mockReturnValue(false);
    renderWeekPage();

    expect(screen.queryByRole("link", { name: "Settimane salvate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salva settimana" })).not.toBeInTheDocument();
  });

  it("shows saved weeks but hides save for a non-Monday start", () => {
    mocks.useHasPermission.mockReturnValue(true);
    renderWeekPage("/week?start=2026-08-25");

    expect(screen.getByRole("link", { name: "Settimane salvate" })).toHaveAttribute("href", "/week/saved");
    expect(screen.queryByRole("button", { name: "Salva settimana" })).not.toBeInTheDocument();
  });
});
