import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { client } from "./client";
import { useDayDiary, useDeleteEntry, usePatchEntry } from "./queries";

vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    client: {
      ...actual.client,
      get: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
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
