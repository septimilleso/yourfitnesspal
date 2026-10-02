import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSaveWeight, useTodayWeight } from "./weights";

afterEach(() => {
  vi.unstubAllGlobals();
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

describe("weight queries", () => {
  it("saves today's weight without sending a date and invalidates weight queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 4, date: "2026-10-02", weight_kg: 78.4 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveWeight(), { wrapper: Wrapper });

    await result.current.mutateAsync(78.4);

    expect(fetchMock).toHaveBeenCalledWith("/api/weights/today", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "PUT",
      body: '{"weight_kg":78.4}',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["weight"] });
  });

  it("returns null when no weight is logged today", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTodayWeight(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/weights/today", {
      credentials: "include",
      headers: { "X-Requested-With": "yfp" },
      method: "GET",
    });
    expect(result.current.data).toBeNull();
  });
});
