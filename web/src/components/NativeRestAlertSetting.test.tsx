import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearGymStore,
  dispatch,
  getSnapshot,
  setClockOffset,
  startEmptyWorkout,
} from "../native/gymStore";

const platform = vi.hoisted(() => ({ native: true }));
const localNotifications = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
}));
const restNotifications = vi.hoisted(() => ({
  cancelRestNotification: vi.fn(),
  getRestAlertsEnabled: vi.fn(),
  setRestAlertsEnabled: vi.fn(),
  syncRestNotification: vi.fn(),
}));
const pushLib = vi.hoisted(() => ({
  disableRestAlerts: vi.fn(),
  enableRestAlerts: vi.fn(),
  isDeviceSubscribed: vi.fn(),
  pushAvailability: vi.fn(),
}));
const auth = vi.hoisted(() => ({ useMe: vi.fn(), useHasPermission: vi.fn(() => false) }));
const filesystem = vi.hoisted(() => ({ deleteFile: vi.fn(), writeFile: vi.fn(), readFile: vi.fn(), stat: vi.fn(), rename: vi.fn() }));

vi.mock("../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: localNotifications }));
vi.mock("../native/restNotifications", () => restNotifications);
vi.mock("../lib/push", () => pushLib);
vi.mock("../api/push", () => ({ getPushConfig: vi.fn(), subscribePush: vi.fn() }));
vi.mock("../auth/AuthContext", () => auth);
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("./RestAlertSetting", () => ({
  default: () => <p>versione web</p>,
}));

import NativeRestAlertSetting from "./NativeRestAlertSetting";
import SettingsPage from "../pages/SettingsPage";

const permissionMessage = /Permesso notifiche negato: riabilitalo in Impostazioni iOS › Notifiche › YFP/;

function renderSetting(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(
    <QueryClientProvider client={queryClient}>
      <NativeRestAlertSetting />
    </QueryClientProvider>,
  );
  return queryClient;
}

function toggle() {
  return screen.getByRole("switch", { name: "Avviso fine riposo" }) as HTMLInputElement;
}

describe("NativeRestAlertSetting", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    platform.native = true;
    filesystem.deleteFile.mockResolvedValue(undefined);
    await clearGymStore();
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);
    localNotifications.checkPermissions.mockResolvedValue({ display: "prompt" });
    localNotifications.requestPermissions.mockResolvedValue({ display: "granted" });
    restNotifications.getRestAlertsEnabled.mockResolvedValue(false);
    restNotifications.setRestAlertsEnabled.mockResolvedValue(undefined);
    restNotifications.syncRestNotification.mockResolvedValue(undefined);
    restNotifications.cancelRestNotification.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts off and does not request permission or schedule just by rendering", async () => {
    renderSetting();

    await waitFor(() => expect(localNotifications.checkPermissions).toHaveBeenCalled());
    expect(toggle()).not.toBeChecked();
    expect(toggle()).not.toBeDisabled();
    expect(localNotifications.requestPermissions).not.toHaveBeenCalled();
    expect(restNotifications.setRestAlertsEnabled).not.toHaveBeenCalled();
    expect(restNotifications.syncRestNotification).not.toHaveBeenCalled();
  });

  it("shows the same visual copy as the web setting", async () => {
    renderSetting();

    expect(await screen.findByText("Avviso fine riposo")).toBeInTheDocument();
    expect(screen.getByText(/Per sentirlo in palestra con un Focus attivo.*Impostazioni iOS › Focus/i)).toBeInTheDocument();
  });

  it("requests the native permission when switched on and enables alerts", async () => {
    renderSetting();
    fireEvent.click(await screen.findByRole("switch", { name: "Avviso fine riposo" }));

    await waitFor(() => expect(localNotifications.requestPermissions).toHaveBeenCalledOnce());
    await waitFor(() => expect(restNotifications.setRestAlertsEnabled).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toggle()).toBeChecked());
  });

  it("schedules the rest notification from the store when switched on during a rest (C37)", async () => {
    const { state } = startEmptyWorkout() as { ok: true; state: { uuid: string } };
    dispatch(state.uuid, { type: "restStart", seconds: 90 });
    setClockOffset(60_000);
    renderSetting();

    fireEvent.click(await screen.findByRole("switch", { name: "Avviso fine riposo" }));

    await waitFor(() =>
      expect(restNotifications.syncRestNotification).toHaveBeenCalledWith(getSnapshot().active?.workout, 60_000),
    );
    expect(restNotifications.syncRestNotification.mock.calls[0][0]).toMatchObject({ rest_ends_at: expect.any(String) });
  });

  it("does not sync when there is no active workout in the store", async () => {
    renderSetting();
    fireEvent.click(await screen.findByRole("switch", { name: "Avviso fine riposo" }));

    await waitFor(() => expect(toggle()).toBeChecked());
    expect(restNotifications.syncRestNotification).not.toHaveBeenCalled();
  });

  it("never calls the web push endpoints or helpers", async () => {
    renderSetting();
    fireEvent.click(await screen.findByRole("switch", { name: "Avviso fine riposo" }));
    await waitFor(() => expect(toggle()).toBeChecked());

    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).not.toBeChecked());

    expect(pushLib.enableRestAlerts).not.toHaveBeenCalled();
    expect(pushLib.disableRestAlerts).not.toHaveBeenCalled();
    const pushCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes("/api/push"));
    expect(pushCalls).toEqual([]);
  });

  it("shows the permission message and stays off when permission is denied", async () => {
    localNotifications.requestPermissions.mockResolvedValue({ display: "denied" });
    renderSetting();
    fireEvent.click(await screen.findByRole("switch", { name: "Avviso fine riposo" }));

    expect(await screen.findByText(permissionMessage)).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
    expect(restNotifications.setRestAlertsEnabled).not.toHaveBeenCalledWith(true);
    expect(restNotifications.syncRestNotification).not.toHaveBeenCalled();
  });

  it("shows the permission message from the start when permission was already denied", async () => {
    localNotifications.checkPermissions.mockResolvedValue({ display: "denied" });
    renderSetting();

    expect(await screen.findByText(permissionMessage)).toBeInTheDocument();
    expect(toggle()).toBeDisabled();
  });

  it("never shows the 'Installa YFP nella schermata Home' message", async () => {
    renderSetting();
    await screen.findByRole("switch", { name: "Avviso fine riposo" });
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle()).toBeChecked());

    expect(screen.queryByText(/Installa YFP nella schermata Home/i)).not.toBeInTheDocument();
  });

  it("never shows the 'Installa YFP' message even when permission is denied", async () => {
    localNotifications.requestPermissions.mockResolvedValue({ display: "denied" });
    renderSetting();
    fireEvent.click(await screen.findByRole("switch", { name: "Avviso fine riposo" }));

    await screen.findByText(permissionMessage);
    expect(screen.queryByText(/Installa YFP/i)).not.toBeInTheDocument();
  });

  it("starts on when alerts are enabled in Preferences and permission is granted", async () => {
    restNotifications.getRestAlertsEnabled.mockResolvedValue(true);
    localNotifications.checkPermissions.mockResolvedValue({ display: "granted" });
    renderSetting();

    await waitFor(() => expect(toggle()).toBeChecked());
    expect(toggle()).not.toBeDisabled();
  });

  it("starts off when alerts are enabled but permission was revoked in iOS Settings", async () => {
    restNotifications.getRestAlertsEnabled.mockResolvedValue(true);
    localNotifications.checkPermissions.mockResolvedValue({ display: "denied" });
    renderSetting();

    expect(await screen.findByText(permissionMessage)).toBeInTheDocument();
    expect(toggle()).not.toBeChecked();
  });

  it("disables alerts and cancels the pending notification when switched off", async () => {
    restNotifications.getRestAlertsEnabled.mockResolvedValue(true);
    localNotifications.checkPermissions.mockResolvedValue({ display: "granted" });
    renderSetting();
    await waitFor(() => expect(toggle()).toBeChecked());

    fireEvent.click(toggle());

    await waitFor(() => expect(toggle()).not.toBeChecked());
    expect(restNotifications.setRestAlertsEnabled).toHaveBeenCalledWith(false);
    expect(restNotifications.cancelRestNotification).toHaveBeenCalledOnce();
    const disabledAt = restNotifications.setRestAlertsEnabled.mock.invocationCallOrder[0];
    const cancelledAt = restNotifications.cancelRestNotification.mock.invocationCallOrder[0];
    expect(disabledAt).toBeLessThan(cancelledAt);
    expect(localNotifications.requestPermissions).not.toHaveBeenCalled();
  });
});

describe("SettingsPage routing between web and native rest alert settings", () => {
  function renderSettings() {
    auth.useHasPermission.mockReturnValue(true);
    auth.useMe.mockReturnValue({
      data: { id: 1, username: "alice", display_name: "Alice", role: "user", permissions: [], mcp_url: "" },
    });
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/settings"]}>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    localNotifications.checkPermissions.mockResolvedValue({ display: "prompt" });
    restNotifications.getRestAlertsEnabled.mockResolvedValue(false);
  });

  it("renders the native toggle inside the app", async () => {
    platform.native = true;
    renderSettings();

    expect(await screen.findByRole("switch", { name: "Avviso fine riposo" })).toBeInTheDocument();
    expect(screen.queryByText("versione web")).not.toBeInTheDocument();
  });

  it("still renders the web RestAlertSetting in the browser", () => {
    platform.native = false;
    renderSettings();

    expect(screen.getByText("versione web")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Avviso fine riposo" })).not.toBeInTheDocument();
  });
});
