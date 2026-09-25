import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { recordActivity } from "../api/queries";
import ActivityTracker from "./ActivityTracker";

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return { ...actual, recordActivity: vi.fn(() => Promise.resolve()) };
});

describe("ActivityTracker", () => {
  it("records activity on mount and when the app becomes visible again", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(
      <QueryClientProvider client={queryClient}>
        <ActivityTracker />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(recordActivity).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["streak"] }));

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(recordActivity).toHaveBeenCalledTimes(2));
  });

  it("ignores failures", async () => {
    vi.mocked(recordActivity).mockRejectedValueOnce(new Error("offline"));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ActivityTracker />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(recordActivity).toHaveBeenCalled());
  });
});
