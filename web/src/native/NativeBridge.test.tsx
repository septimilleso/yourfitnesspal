import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { gymKeys, type Workout } from "../api/gym";
import NativeBridge from "./NativeBridge";

const platform = vi.hoisted(() => ({ native: true }));
const restNotifications = vi.hoisted(() => ({
  syncRestNotification: vi.fn(),
  installNotificationSound: vi.fn(),
}));
const localNotifications = vi.hoisted(() => ({ addListener: vi.fn() }));

vi.mock("./platform", () => ({ isNative: () => platform.native }));
vi.mock("./restNotifications", () => restNotifications);
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: localNotifications }));

function workout(): Workout {
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

beforeEach(() => {
  vi.clearAllMocks();
  platform.native = true;
  restNotifications.syncRestNotification.mockResolvedValue(undefined);
  restNotifications.installNotificationSound.mockResolvedValue(undefined);
  localNotifications.addListener.mockResolvedValue({ remove: vi.fn() });
});

describe("NativeBridge on the native platform", () => {
  it("installs the notification sound once at startup", () => {
    renderBridge();

    expect(restNotifications.installNotificationSound).toHaveBeenCalledOnce();
  });

  it("syncs the rest notification whenever the active workout cache is updated", async () => {
    const queryClient = renderBridge();
    const active = workout();

    act(() => {
      queryClient.setQueryData(gymKeys.active, active);
    });
    await waitFor(() => expect(restNotifications.syncRestNotification).toHaveBeenCalledWith(active));

    act(() => {
      queryClient.setQueryData(gymKeys.active, null);
    });
    await waitFor(() => expect(restNotifications.syncRestNotification).toHaveBeenLastCalledWith(null));
  });

  it("ignores cache updates for other queries", async () => {
    const queryClient = renderBridge();

    act(() => {
      queryClient.setQueryData(["gym", "stats"], { finished: 3 });
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
    const queryClient = renderBridge();

    act(() => {
      queryClient.setQueryData(gymKeys.active, workout());
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(screen.queryByText("start page")).toBeInTheDocument();
    expect(restNotifications.installNotificationSound).not.toHaveBeenCalled();
    expect(restNotifications.syncRestNotification).not.toHaveBeenCalled();
    expect(localNotifications.addListener).not.toHaveBeenCalled();
  });
});
