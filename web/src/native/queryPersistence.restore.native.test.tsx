import { LocalNotifications } from "@capacitor/local-notifications";
import { dehydrate, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gymKeys, type Workout } from "../api/gym";
import NativeBridge from "./NativeBridge";
import { restoreQueryCache } from "./queryPersistence";

const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
}));
const localNotifications = vi.hoisted(() => ({
  schedule: vi.fn(),
  cancel: vi.fn(),
  checkPermissions: vi.fn(),
  addListener: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: localNotifications }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn().mockResolvedValue({ value: null }), set: vi.fn(), remove: vi.fn() },
}));
vi.mock("./platform", () => ({ isNative: () => true }));

const ME = { id: 7, username: "simone" };

// Allenamento con il riposo finito da 3 ore: se tornasse in cache, la barra e la notifica sarebbero false.
function staleWorkout(): Workout {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  return {
    id: 1,
    name: "Giorno 1",
    template_id: null,
    status: "in_progress",
    started_at: threeHoursAgo,
    finished_at: null,
    rest_ends_at: threeHoursAgo,
    rest_total_s: 90,
    server_now: threeHoursAgo,
    exercises: [],
    template_diff: [],
  };
}

function cacheFile(): string {
  const source = new QueryClient();
  source.setQueryData(["me"], ME);
  source.setQueryData(gymKeys.active, staleWorkout());
  const state = dehydrate(source, { shouldDehydrateQuery: () => true });
  return JSON.stringify({ buster: "1|build-a", savedAt: Date.now(), state });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_BUILD_ID", "build-a");
  localNotifications.addListener.mockResolvedValue({ remove: vi.fn() });
  filesystem.readFile.mockResolvedValue({ data: cacheFile() });
  filesystem.deleteFile.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("restoring the query cache on the native platform", () => {
  it("does not restore the live workout, so no rest timer or notification comes back", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NativeBridge />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Il mount chiama installNotificationSound: i conteggi partono dopo.
    vi.clearAllMocks();

    await restoreQueryCache(queryClient);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(queryClient.getQueryData(["me"])).toEqual(ME);
    expect(queryClient.getQueryData(gymKeys.active)).toBeUndefined();
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    expect(LocalNotifications.cancel).not.toHaveBeenCalled();
  });
});
