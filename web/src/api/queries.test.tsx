import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { client } from "./client";
import {
  useCreateEntry,
  useDayDiary,
  useDeleteEntry,
  useDiaryRange,
  useFoodByBarcode,
  useFoodSearch,
  usePatchEntry,
  useRecentFoods,
  useStreak,
  recordActivity,
} from "./queries";

vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    client: {
      ...actual.client,
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

afterEach(() => {
  // Mock call history otherwise leaks across tests in this file (e.g. a
  // "not called" assertion in a later test seeing an earlier test's calls).
  vi.clearAllMocks();
});

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

describe("useDiaryRange", () => {
  it("fetches totals for the inclusive range", async () => {
    const response = { start: "2026-09-01", end: "2026-09-07", days: [] };
    vi.mocked(client.get).mockResolvedValueOnce(response);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useDiaryRange("2026-09-01", "2026-09-07"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.get).toHaveBeenCalledWith("/diary/range?start=2026-09-01&end=2026-09-07");
    expect(result.current.data).toEqual(response);
  });

  it("does not fetch when disabled", () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => useDiaryRange("2026-09-07", "2026-09-01", false), { wrapper: Wrapper });
    expect(client.get).not.toHaveBeenCalled();
  });
});

describe("useStreak", () => {
  it("fetches the streak", async () => {
    vi.mocked(client.get).mockResolvedValueOnce({ current: 3, best: 5 });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useStreak(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ current: 3, best: 5 }));
    expect(client.get).toHaveBeenCalledWith("/stats/streak");
  });
});

describe("recordActivity", () => {
  it("posts to /activity", async () => {
    vi.mocked(client.post).mockResolvedValueOnce(undefined);
    await recordActivity();
    expect(client.post).toHaveBeenCalledWith("/activity");
  });
});

describe("useDayDiary", () => {
  it("fetches the day response for the given date", async () => {
    const dayResponse = {
      date: "2026-08-26",
      entries: { breakfast: [], lunch: [], dinner: [], snack: [] },
      totals: {
        by_meal: {},
        total: {
          kcal: 0,
          protein_g: 0,
          carbs_g: 0,
          sugars_g: 0,
          fat_g: 0,
          sat_fat_g: 0,
          fiber_g: 0,
          salt_g: 0,
        },
      },
      goal: null,
      delta: null,
    };
    vi.mocked(client.get).mockResolvedValue(dayResponse);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDayDiary("2026-08-26"), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.get).toHaveBeenCalledWith("/diary/day/2026-08-26");
    expect(result.current.data).toEqual(dayResponse);
  });
});

describe("useDeleteEntry", () => {
  it("calls DELETE on the entry endpoint with the given id", async () => {
    vi.mocked(client.delete).mockResolvedValue(undefined);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useDeleteEntry(), { wrapper: Wrapper });

    result.current.mutate(42);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.delete).toHaveBeenCalledWith("/diary/entries/42");
  });
});

describe("usePatchEntry", () => {
  it("calls PATCH on the entry endpoint with the given fields", async () => {
    vi.mocked(client.patch).mockResolvedValue({});
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => usePatchEntry(), { wrapper: Wrapper });

    result.current.mutate({ id: 7, grams: 150 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.patch).toHaveBeenCalledWith("/diary/entries/7", { grams: 150 });
  });
});

function food(overrides: Partial<import("./queries").FoodSearchItem> = {}) {
  return {
    id: 1,
    barcode: null,
    name: "Acqua",
    brand: null,
    image_url: null,
    serving_size_g: null,
    nutriments: {
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      sugars_g: 0,
      fat_g: 0,
      sat_fat_g: 0,
      fiber_g: 0,
      salt_g: 0,
    },
    source: "cache" as const,
    ...overrides,
  };
}

describe("useFoodSearch", () => {
  it("does not query while the search term is empty/whitespace", () => {
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useFoodSearch("   "), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(client.get).not.toHaveBeenCalled();
  });

  it("fetches /foods/search with the trimmed query and a limit", async () => {
    vi.mocked(client.get).mockResolvedValue({ results: [food()] });
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useFoodSearch("  acqua  "), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.get).toHaveBeenCalledWith("/foods/search?q=acqua&limit=20");
    expect(result.current.data?.results).toEqual([food()]);
  });
});

describe("useRecentFoods", () => {
  it("fetches /foods/recent", async () => {
    vi.mocked(client.get).mockResolvedValue({ results: [food({ id: 2, name: "Pane" })] });
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useRecentFoods(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.get).toHaveBeenCalledWith("/foods/recent");
    expect(result.current.data?.results).toEqual([food({ id: 2, name: "Pane" })]);
  });
});

describe("useFoodByBarcode", () => {
  it("calls GET on the barcode endpoint with the given code", async () => {
    vi.mocked(client.get).mockResolvedValue({ ...food(), source: "off" });
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useFoodByBarcode(), { wrapper: Wrapper });

    result.current.mutate("8001505005707");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.get).toHaveBeenCalledWith("/foods/barcode/8001505005707");
  });
});

describe("useCreateEntry", () => {
  it("posts the entry payload and invalidates the day-diary cache", async () => {
    vi.mocked(client.post).mockResolvedValue({});
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateEntry(), { wrapper: Wrapper });

    result.current.mutate({ date: "2026-08-26", meal: "breakfast", food_id: 5, grams: 250 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.post).toHaveBeenCalledWith("/diary/entries", {
      date: "2026-08-26",
      meal: "breakfast",
      food_id: 5,
      grams: 250,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["diary", "day"] });
  });
});
