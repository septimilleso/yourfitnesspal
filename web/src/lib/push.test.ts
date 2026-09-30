import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { subscribePush, unsubscribePush } = vi.hoisted(() => ({
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

vi.mock("../api/push", () => ({ subscribePush, unsubscribePush }));

import {
  currentSubscription,
  disableRestAlerts,
  enableRestAlerts,
  isDeviceSubscribed,
  pushAvailability,
  unsubscribeDeviceOnLogout,
  urlBase64ToUint8Array,
} from "./push";

const serviceWorkerDescriptor = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

function setServiceWorker(value: unknown) {
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value });
}

function setBrowserApi(permission: NotificationPermission = "granted") {
  const NotificationMock = {
    permission,
    requestPermission: vi.fn().mockResolvedValue(permission),
  };
  vi.stubGlobal("Notification", NotificationMock);
  vi.stubGlobal("PushManager", class PushManagerMock {});
  return NotificationMock;
}

function makeSubscription(endpoint = "https://push.example/subscription") {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "public-key", auth: "auth-key" } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  } as unknown as PushSubscription;
}

describe("push helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscribePush.mockResolvedValue(undefined);
    unsubscribePush.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (serviceWorkerDescriptor) {
      Object.defineProperty(navigator, "serviceWorker", serviceWorkerDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "serviceWorker");
    }
  });

  it("reports unsupported, denied, and available browser states", () => {
    setBrowserApi();
    setServiceWorker(undefined);
    expect(pushAvailability()).toBe("unsupported");

    setServiceWorker({ getRegistration: vi.fn() });
    expect(pushAvailability()).toBe("available");

    vi.stubGlobal("PushManager", undefined);
    expect(pushAvailability()).toBe("unsupported");
    vi.stubGlobal("PushManager", class PushManagerMock {});
    vi.stubGlobal("Notification", undefined);
    expect(pushAvailability()).toBe("unsupported");

    setBrowserApi("denied");
    expect(pushAvailability()).toBe("denied");
  });

  it("requests permission before subscribing and registers the browser subscription", async () => {
    const browserSubscription = makeSubscription();
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(browserSubscription),
    };
    const registration = { pushManager };
    const ready = Promise.resolve(registration);
    setServiceWorker({ ready, getRegistration: vi.fn().mockResolvedValue(registration) });
    const notification = setBrowserApi("granted");
    const sequence: string[] = [];
    notification.requestPermission.mockImplementation(async () => {
      sequence.push("permission");
      return "granted";
    });
    pushManager.subscribe.mockImplementation(async () => {
      sequence.push("subscribe");
      return browserSubscription;
    });
    subscribePush.mockImplementation(async () => {
      sequence.push("server");
    });

    await expect(enableRestAlerts("AQID")).resolves.toBe("enabled");

    expect(sequence).toEqual(["permission", "subscribe", "server"]);
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(subscribePush).toHaveBeenCalledWith(browserSubscription.toJSON());
  });

  it("does not subscribe when notification permission is denied", async () => {
    const pushManager = { getSubscription: vi.fn(), subscribe: vi.fn() };
    setServiceWorker({ ready: Promise.resolve({ pushManager }) });
    setBrowserApi("denied");

    await expect(enableRestAlerts("AQID")).resolves.toBe("denied");

    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(subscribePush).not.toHaveBeenCalled();
  });

  it("unsubscribes locally and rethrows when registering on the server fails", async () => {
    const subscription = makeSubscription();
    const pushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(subscription),
    };
    setServiceWorker({ ready: Promise.resolve({ pushManager }) });
    setBrowserApi("granted");
    const serverError = new Error("server unavailable");
    subscribePush.mockRejectedValue(serverError);

    await expect(enableRestAlerts("AQID")).rejects.toBe(serverError);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it("removes the current subscription from the server and browser", async () => {
    const subscription = makeSubscription();
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
    setServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) });

    await disableRestAlerts();

    expect(unsubscribePush).toHaveBeenCalledWith(subscription.endpoint);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(unsubscribePush.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(subscription.unsubscribe).mock.invocationCallOrder[0]);
  });

  it("checks the current registration and requires granted permission for device status", async () => {
    const subscription = makeSubscription();
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
    setServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) });
    setBrowserApi("granted");

    await expect(currentSubscription()).resolves.toBe(subscription);
    await expect(isDeviceSubscribed()).resolves.toBe(true);

    setBrowserApi("default");
    await expect(isDeviceSubscribed()).resolves.toBe(false);
  });

  it("does not throw on logout when there is no registration", async () => {
    setServiceWorker({ getRegistration: vi.fn().mockResolvedValue(undefined) });

    await expect(unsubscribeDeviceOnLogout()).resolves.toBeUndefined();
    expect(unsubscribePush).not.toHaveBeenCalled();
  });

  it("unsubscribes locally when server unsubscription outlasts the logout timeout", async () => {
    vi.useFakeTimers();
    const subscription = makeSubscription();
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
    setServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) });
    let startServerRequest!: () => void;
    const serverRequestStarted = new Promise<void>((resolve) => {
      startServerRequest = resolve;
    });
    unsubscribePush.mockImplementation(
      () =>
        new Promise<void>(() => {
          startServerRequest();
        }),
    );

    const logout = unsubscribeDeviceOnLogout();
    await serverRequestStarted;
    await vi.advanceTimersByTimeAsync(3000);
    await expect(logout).resolves.toBeUndefined();

    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("does not throw on logout when server unsubscription fails", async () => {
    const subscription = makeSubscription();
    const registration = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } };
    setServiceWorker({ getRegistration: vi.fn().mockResolvedValue(registration) });
    unsubscribePush.mockRejectedValue(new Error("offline"));

    await expect(unsubscribeDeviceOnLogout()).resolves.toBeUndefined();
  });

  it("decodes URL-safe base64 into bytes", () => {
    expect(Array.from(urlBase64ToUint8Array("AQIDBA=="))).toEqual([1, 2, 3, 4]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});
