import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useApplySavedWeek,
  useDeleteSavedWeek,
  useRenameSavedWeek,
  useSaveWeek,
  useSavedWeek,
  useSavedWeeks,
} from "./savedWeeks";

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

const summary = {
  id: 4,
  name: "Dieta A",
  created_at: "2026-10-05T12:00:00Z",
  entries_count: 5,
  avg_kcal: 420,
};

function successfulResponse(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body };
}

describe("saved week queries", () => {
  it("fetches the saved weeks list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse([summary]));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSavedWeeks(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith("/api/saved-weeks", {
      credentials: "include",
      headers: { "X-Requested-With": "yfp" },
      method: "GET",
    });
    expect(result.current.data).toEqual([summary]);
  });

  it("fetches one saved week by id without retrying", async () => {
    const detail = { ...summary, days: [] };
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse(detail));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSavedWeek(4), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/saved-weeks/4", {
      credentials: "include",
      headers: { "X-Requested-With": "yfp" },
      method: "GET",
    });
    expect(result.current.data).toEqual(detail);
  });
});

describe("saved week mutations", () => {
  it("saves a week and invalidates saved week queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse(summary, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSaveWeek(), { wrapper: Wrapper });

    await result.current.mutateAsync({ name: "Dieta A", start: "2026-10-05" });

    expect(fetchMock).toHaveBeenCalledWith("/api/saved-weeks", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"name":"Dieta A","start":"2026-10-05"}',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["saved-weeks"] });
  });

  it("renames a week and invalidates saved week queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse({ ...summary, name: "Dieta B" }));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRenameSavedWeek(), { wrapper: Wrapper });

    await result.current.mutateAsync({ id: 4, name: "Dieta B" });

    expect(fetchMock).toHaveBeenCalledWith("/api/saved-weeks/4", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "PATCH",
      body: '{"name":"Dieta B"}',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["saved-weeks"] });
  });

  it("deletes a week and invalidates saved week queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteSavedWeek(), { wrapper: Wrapper });

    await result.current.mutateAsync(4);

    expect(fetchMock).toHaveBeenCalledWith("/api/saved-weeks/4", {
      credentials: "include",
      headers: { "X-Requested-With": "yfp" },
      method: "DELETE",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["saved-weeks"] });
  });

  it("applies a week and invalidates diary week and day queries", async () => {
    const response = { entries_created: 5, days: [{ date: "2026-10-12", entries_created: 5 }] };
    const fetchMock = vi.fn().mockResolvedValue(successfulResponse(response));
    vi.stubGlobal("fetch", fetchMock);
    const { Wrapper, queryClient } = makeWrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useApplySavedWeek(), { wrapper: Wrapper });

    await result.current.mutateAsync({
      id: 4,
      days: [1, 3],
      target_start: "2026-10-12",
      meals: ["lunch"],
      mode: "replace",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/saved-weeks/4/apply", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"days":[1,3],"target_start":"2026-10-12","meals":["lunch"],"mode":"replace"}',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["diary", "week"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["diary", "day"] });
  });
});
