import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { gymKeys, type Workout } from "../api/gym";
import NativeBridge from "./NativeBridge";
import {
  clearGymStore,
  dispatch,
  getSnapshot,
  removeEntry,
  setClockOffset,
  setTemplateProposals,
  startEmptyWorkout,
} from "./gymStore";

const platform = vi.hoisted(() => ({ native: true }));
const restNotifications = vi.hoisted(() => ({
  syncRestNotification: vi.fn(),
  installNotificationSound: vi.fn(),
}));
const localNotifications = vi.hoisted(() => ({ addListener: vi.fn() }));
const filesystem = vi.hoisted(() => ({ writeFile: vi.fn(), readFile: vi.fn(), stat: vi.fn(), deleteFile: vi.fn(), rename: vi.fn() }));

vi.mock("./platform", () => ({ isNative: () => platform.native }));
vi.mock("./restNotifications", () => restNotifications);
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: localNotifications }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));

function serverWorkout(): Workout {
  return {
    id: 7,
    name: "Giorno 2",
    template_id: null,
    status: "in_progress",
    started_at: "2026-10-12T10:00:00.000Z",
    finished_at: null,
    rest_ends_at: "2026-10-12T10:01:00.000Z",
    rest_total_s: 60,
    server_now: "2026-10-12T10:00:30.000Z",
    exercises: [],
    template_diff: [],
  };
}

function renderBridge(queryClient = new QueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/gym"]}>
        <NativeBridge />
        <Routes>
          <Route path="/gym" element={<div>start page</div>} />
          <Route path="/gym/workout" element={<div>live workout</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** L'allenamento attivo nello store, con un riposo di 90 s avviato sul clock del server. */
function startWorkoutWithRest(): string {
  const { state } = startEmptyWorkout() as { ok: true; state: { uuid: string } };
  dispatch(state.uuid, { type: "restStart", seconds: 90 });
  return state.uuid;
}

function lastSynced(): [unknown, number] {
  const { calls } = restNotifications.syncRestNotification.mock;
  return calls[calls.length - 1] as [unknown, number];
}

beforeEach(async () => {
  vi.clearAllMocks();
  platform.native = true;
  restNotifications.syncRestNotification.mockResolvedValue(undefined);
  restNotifications.installNotificationSound.mockResolvedValue(undefined);
  localNotifications.addListener.mockResolvedValue({ remove: vi.fn() });
  filesystem.deleteFile.mockResolvedValue(undefined);
  await clearGymStore();
});

describe("NativeBridge on the native platform", () => {
  it("installs the notification sound once at startup", () => {
    renderBridge();

    expect(restNotifications.installNotificationSound).toHaveBeenCalledOnce();
  });

  it("rebuilds the rest notification from the loaded store at startup (C37)", () => {
    startWorkoutWithRest();
    setClockOffset(60_000);
    const active = getSnapshot().active?.workout;

    renderBridge();

    expect(restNotifications.syncRestNotification).toHaveBeenCalledWith(active, 60_000);
  });

  it("syncs the rest notification with the store clock offset when the rest changes (C23)", () => {
    renderBridge();
    startWorkoutWithRest();
    act(() => {
      setClockOffset(60_000);
    });

    expect(lastSynced()).toEqual([getSnapshot().active?.workout, 60_000]);
  });

  it("cancels the rest notification when the rest is skipped (C46)", () => {
    const uuid = startWorkoutWithRest();
    renderBridge();

    act(() => {
      dispatch(uuid, { type: "restSkip" });
    });

    expect(lastSynced()[0]).toMatchObject({ rest_ends_at: null });
  });

  it("cancels the rest notification when the active workout is removed (C46)", () => {
    const uuid = startWorkoutWithRest();
    renderBridge();

    act(() => {
      removeEntry(uuid);
    });

    expect(lastSynced()).toEqual([null, 0]);
  });

  it("cancels the rest notification when the store is cleared on logout (C46)", async () => {
    startWorkoutWithRest();
    renderBridge();

    await act(() => clearGymStore());

    expect(lastSynced()).toEqual([null, 0]);
  });

  it("does not reschedule when the store changes without touching the rest", () => {
    startWorkoutWithRest();
    renderBridge();
    const calls = restNotifications.syncRestNotification.mock.calls.length;

    act(() => {
      setTemplateProposals([5]);
    });

    expect(restNotifications.syncRestNotification).toHaveBeenCalledTimes(calls);
  });

  it("ignores query cache updates for the active workout, the store is the source", async () => {
    const queryClient = renderBridge();

    act(() => {
      queryClient.setQueryData(gymKeys.active, serverWorkout());
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(restNotifications.syncRestNotification).not.toHaveBeenCalled();
  });

  it("navigates to /gym/workout when the notification is tapped", async () => {
    renderBridge();
    await waitFor(() => expect(localNotifications.addListener).toHaveBeenCalled());
    const [, listener] = localNotifications.addListener.mock.calls[0];

    act(() => {
      listener({ actionId: "tap", notification: { extra: { url: "/gym/workout" } } });
    });

    expect(await screen.findByText("live workout")).toBeInTheDocument();
  });
});

describe("NativeBridge on the web platform", () => {
  beforeEach(() => {
    platform.native = false;
  });

  it("renders nothing and calls no plugin", async () => {
    startWorkoutWithRest();
    renderBridge();

    act(() => {
      setClockOffset(60_000);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.queryByText("start page")).toBeInTheDocument();
    expect(restNotifications.installNotificationSound).not.toHaveBeenCalled();
    expect(restNotifications.syncRestNotification).not.toHaveBeenCalled();
    expect(localNotifications.addListener).not.toHaveBeenCalled();
  });
});
