import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DayResponse } from "../api/queries";
import { useDayDiary, useDeleteEntry, usePatchEntry } from "../api/queries";
import DayPage from "./DayPage";

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return {
    ...actual,
    useDayDiary: vi.fn(),
    useDeleteEntry: vi.fn(),
    usePatchEntry: vi.fn(),
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

const dayResponse: DayResponse = {
  date: "2026-08-26",
  entries: {
    breakfast: [
      {
        id: 1,
        food_id: 100,
        food_name: "Yogurt greco",
        food_brand: "Fage",
        date: "2026-08-26",
        meal: "breakfast",
        grams: 200,
        portion_label: null,
        position: 0,
        nutriments_snapshot: nutriments(100),
      },
    ],
    lunch: [
      {
        id: 2,
        food_id: 101,
        food_name: "Pasta integrale",
        food_brand: null,
        date: "2026-08-26",
        meal: "lunch",
        grams: 150,
        portion_label: null,
        position: 0,
        nutriments_snapshot: nutriments(200),
      },
    ],
    dinner: [],
    snack: [],
  },
  totals: {
    by_meal: {},
    total: {
      kcal: 500,
      protein_g: 30,
      carbs_g: 60,
      sugars_g: 10,
      fat_g: 15,
      sat_fat_g: 5,
      fiber_g: 8,
      salt_g: 1,
    },
  },
  goal: {
    id: 1,
    kcal: 2000,
    protein_g: 150,
    carbs_g: 250,
    fat_g: 70,
    valid_from: "2026-01-01",
  },
  delta: {
    kcal: 1500,
    protein_g: 120,
    carbs_g: 190,
    fat_g: 55,
  },
};

const deleteMutate = vi.fn();
const patchMutate = vi.fn();

function setupMocks(overrides: Partial<ReturnType<typeof useDayDiary>> = {}) {
  vi.mocked(useDayDiary).mockReturnValue({
    data: dayResponse,
    isLoading: false,
    isError: false,
    ...overrides,
  } as ReturnType<typeof useDayDiary>);
  vi.mocked(useDeleteEntry).mockReturnValue({
    mutate: deleteMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteEntry>);
  vi.mocked(usePatchEntry).mockReturnValue({
    mutate: patchMutate,
    isPending: false,
  } as unknown as ReturnType<typeof usePatchEntry>);
}

function renderDayPage(initialPath = "/?date=2026-08-26") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<DayPage />} />
        <Route path="/search" element={<div>Search Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DayPage", () => {
  beforeEach(() => {
    deleteMutate.mockClear();
    patchMutate.mockClear();
  });

  it("renders meal sections with their food rows", () => {
    setupMocks();
    renderDayPage();

    expect(screen.getByText("Yogurt greco")).toBeInTheDocument();
    expect(screen.getByText(/Fage/)).toBeInTheDocument();
    expect(screen.getByText("Pasta integrale")).toBeInTheDocument();
    expect(screen.getByText(/Colazione/i)).toBeInTheDocument();
    expect(screen.getByText(/Pranzo/i)).toBeInTheDocument();
    expect(screen.getByText(/Cena/i)).toBeInTheDocument();
    expect(screen.getByText(/Spuntino/i)).toBeInTheDocument();
  });

  it("falls back to an Alimento #id label when food_name is missing from a malformed response", () => {
    setupMocks({
      data: {
        ...dayResponse,
        entries: {
          ...dayResponse.entries,
          breakfast: [
            {
              ...dayResponse.entries.breakfast[0],
              // @ts-expect-error -- simulating a malformed API response
              food_name: undefined,
            },
          ],
        },
      },
    });
    renderDayPage();

    expect(screen.getByText("Alimento #100")).toBeInTheDocument();
  });

  it("renders the day totals", () => {
    setupMocks();
    renderDayPage();

    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("calls the delete mutation with the entry's id when its delete button is clicked", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDayPage();

    await user.click(screen.getByRole("button", { name: /elimina yogurt greco/i }));

    expect(deleteMutate).toHaveBeenCalledWith(1);
  });

  it("links + Aggiungi to /search with the date and meal", () => {
    setupMocks();
    renderDayPage();

    // There are 4 "+ Aggiungi" links (one per meal); grab all and check breakfast's.
    const links = screen.getAllByRole("link", { name: /aggiungi/i });
    expect(links).toHaveLength(4);
    const breakfastLink = links.find((l) => l.getAttribute("href")?.includes("meal=breakfast"));
    expect(breakfastLink).toBeDefined();
    expect(breakfastLink?.getAttribute("href")).toBe("/search?date=2026-08-26&meal=breakfast");
  });

  it("shows a loading state while the query is pending", () => {
    setupMocks({ data: undefined, isLoading: true } as Partial<ReturnType<typeof useDayDiary>>);
    renderDayPage();

    expect(screen.getByText(/caricamento/i)).toBeInTheDocument();
  });
});
