import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Workout } from "../api/gym";

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
const localNotifications = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  addListener: vi.fn(),
}));
const filesystem = vi.hoisted(() => ({ writeFile: vi.fn() }));
const platform = vi.hoisted(() => ({ native: true }));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: localNotifications }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
}));
vi.mock("./platform", () => ({ isNative: () => platform.native }));

const NOW = Date.parse("2026-10-12T10:00:00.000Z");
// Il telefono è avanti di 5 s rispetto al server: l'offset è +5000 ms.
const SERVER_OFFSET_MS = 5000;

async function loadModule() {
  vi.resetModules();
  return import("./restNotifications");
}

function workout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 1,
    name: "Giorno 1",
    template_id: null,
    status: "in_progress",
    started_at: new Date(NOW).toISOString(),
    finished_at: null,
    rest_ends_at: new Date(NOW + SERVER_OFFSET_MS + 30_000).toISOString(),
    rest_total_s: 30,
    server_now: new Date(NOW + SERVER_OFFSET_MS).toISOString(),
    exercises: [],
    template_diff: [],
    ...overrides,
  };
}

function restEndingIn(seconds: number): string {
  return new Date(NOW + SERVER_OFFSET_MS + seconds * 1000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  preferences.get.mockResolvedValue({ value: "true" });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  localNotifications.checkPermissions.mockResolvedValue({ display: "granted" });
  localNotifications.requestPermissions.mockResolvedValue({ display: "granted" });
  localNotifications.schedule.mockResolvedValue({ notifications: [] });
  localNotifications.cancel.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue({ uri: "file:///rest-bell.wav" });
  platform.native = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("rest notifications on the native platform", () => {
  it("schedules one notification at the offset-corrected instant with the workout name", async () => {
    const { syncRestNotification } = await loadModule();

    await syncRestNotification(workout());

    expect(localNotifications.schedule).toHaveBeenCalledOnce();
    const [{ notifications }] = localNotifications.schedule.mock.calls[0];
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: "Riposo finito · Giorno 1",
      sound: "rest-bell.wav",
      extra: { url: "/gym/workout" },
    });
    expect(notifications[0].schedule.at.getTime()).toBe(NOW + 30_000);
  });

  it("uses the plain title when the workout has no name", async () => {
    const { syncRestNotification } = await loadModule();

    await syncRestNotification(workout({ name: "   " }));

    const [{ notifications }] = localNotifications.schedule.mock.calls[0];
    expect(notifications[0].title).toBe("Riposo finito");
  });

  it("replaces the pending notification with the same id when rest_ends_at moves (+15 s)", async () => {
    const { syncRestNotification } = await loadModule();

    await syncRestNotification(workout());
    await syncRestNotification(workout({ rest_ends_at: restEndingIn(45) }));

    expect(localNotifications.schedule).toHaveBeenCalledTimes(2);
    const [first] = localNotifications.schedule.mock.calls[0][0].notifications;
    const [second] = localNotifications.schedule.mock.calls[1][0].notifications;
    expect(second.id).toBe(first.id);
    expect(second.schedule.at.getTime()).toBe(NOW + 45_000);
    const cancelIds = localNotifications.cancel.mock.calls.map(([options]) => options.notifications[0].id);
    expect(cancelIds).toContain(first.id);
    expect(localNotifications.cancel.mock.invocationCallOrder.at(-1)).toBeLessThan(
      localNotifications.schedule.mock.invocationCallOrder[1],
    );
  });

  it("cancels the pending notification when rest_ends_at is null (skipped rest)", async () => {
    const { syncRestNotification } = await loadModule();

    await syncRestNotification(workout({ rest_ends_at: null }));

    expect(localNotifications.schedule).not.toHaveBeenCalled();
    expect(localNotifications.cancel).toHaveBeenCalledOnce();
  });

  it("cancels when there is no active workout (finished or cancelled)", async () => {
    const { syncRestNotification } = await loadModule();

    await syncRestNotification(null);

    expect(localNotifications.schedule).not.toHaveBeenCalled();
    expect(localNotifications.cancel).toHaveBeenCalledOnce();
  });

  it("cancels instead of scheduling when rest_ends_at is already in the past", async () => {
    const { syncRestNotification } = await loadModule();

    await syncRestNotification(workout({ rest_ends_at: restEndingIn(-1) }));

    expect(localNotifications.schedule).not.toHaveBeenCalled();
    expect(localNotifications.cancel).toHaveBeenCalledOnce();
  });

  it("cancels and does not schedule when the alert is disabled", async () => {
    preferences.get.mockResolvedValue({ value: null });
    const { syncRestNotification } = await loadModule();

    await syncRestNotification(workout());

    expect(localNotifications.schedule).not.toHaveBeenCalled();
    expect(localNotifications.cancel).toHaveBeenCalledOnce();
  });

  it("cancels and does not schedule when the permission is not granted", async () => {
    localNotifications.checkPermissions.mockResolvedValue({ display: "denied" });
    const { syncRestNotification } = await loadModule();

    await syncRestNotification(workout());

    expect(localNotifications.schedule).not.toHaveBeenCalled();
    expect(localNotifications.cancel).toHaveBeenCalledOnce();
  });

  it("cancelRestNotification cancels the fixed notification id", async () => {
    const { syncRestNotification, cancelRestNotification } = await loadModule();
    await syncRestNotification(workout());
    const [{ notifications }] = localNotifications.schedule.mock.calls[0];

    await cancelRestNotification();

    expect(localNotifications.cancel).toHaveBeenLastCalledWith({
      notifications: [{ id: notifications[0].id }],
    });
  });

  it("serializes overlapping syncs so the last call decides the final state", async () => {
    const { syncRestNotification } = await loadModule();

    await Promise.all([syncRestNotification(workout()), syncRestNotification(null)]);

    expect(localNotifications.schedule).toHaveBeenCalledOnce();
    expect(localNotifications.cancel.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      localNotifications.schedule.mock.invocationCallOrder[0],
    );
  });

  it("stores the alert preference in Preferences under yfp.restAlerts", async () => {
    const { getRestAlertsEnabled, setRestAlertsEnabled } = await loadModule();

    await setRestAlertsEnabled(true);
    expect(preferences.set).toHaveBeenCalledWith({ key: "yfp.restAlerts", value: "true" });

    preferences.get.mockResolvedValue({ value: "false" });
    expect(await getRestAlertsEnabled()).toBe(false);
    preferences.get.mockResolvedValue({ value: "true" });
    expect(await getRestAlertsEnabled()).toBe(true);
    expect(preferences.get).toHaveBeenCalledWith({ key: "yfp.restAlerts" });
  });

  it("copies rest-bell.wav into Library/Sounds as base64", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    );
    const { installNotificationSound } = await loadModule();

    await installNotificationSound();

    expect(fetch).toHaveBeenCalledWith("/sounds/rest-bell.wav");
    expect(filesystem.writeFile).toHaveBeenCalledWith({
      path: "Sounds/rest-bell.wav",
      data: "AQID",
      directory: "LIBRARY",
      recursive: true,
    });
  });

  it("ignores sound installation failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { installNotificationSound } = await loadModule();

    await expect(installNotificationSound()).resolves.toBeUndefined();
    expect(filesystem.writeFile).not.toHaveBeenCalled();
  });
});

describe("rest notifications on the web platform", () => {
  beforeEach(() => {
    platform.native = false;
  });

  it("is a no-op: no plugin is called and nothing is fetched", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const module = await loadModule();

    await module.syncRestNotification(workout());
    await module.syncRestNotification(null);
    await module.cancelRestNotification();
    await module.setRestAlertsEnabled(true);
    await module.installNotificationSound();

    expect(await module.getRestAlertsEnabled()).toBe(false);
    expect(localNotifications.schedule).not.toHaveBeenCalled();
    expect(localNotifications.cancel).not.toHaveBeenCalled();
    expect(localNotifications.checkPermissions).not.toHaveBeenCalled();
    expect(preferences.set).not.toHaveBeenCalled();
    expect(filesystem.writeFile).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
