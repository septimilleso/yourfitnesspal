import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetConnectivityForTests } from "../native/connectivity";
import { createQueryClient } from "../lib/queryClient";
import { useSavedWeek } from "./savedWeeks";

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));
vi.mock("../native/platform", () => ({ isNative: () => true }));

let queryClient: QueryClient | undefined;

afterEach(() => {
  queryClient?.clear();
  queryClient = undefined;
  vi.unstubAllGlobals();
  resetConnectivityForTests();
});

const detail = {
  id: 4,
  name: "Dieta A",
  created_at: "2026-10-05T12:00:00Z",
  entries_count: 5,
  avg_kcal: 420,
  days: [],
};

describe("useSavedWeek on the native platform", () => {
  it("keeps the cached week when the network is down, instead of failing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    queryClient = createQueryClient(true);
    queryClient.setQueryData(["saved-weeks", "detail", 4], detail);
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient!}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useSavedWeek(4), { wrapper: Wrapper });

    // Il retry di rete parte dopo 1 s e poi va in pausa finché la rete non torna.
    await waitFor(() => expect(result.current.fetchStatus).toBe("paused"), { timeout: 3000 });
    expect(result.current.status).toBe("success");
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(detail);
  });
});
