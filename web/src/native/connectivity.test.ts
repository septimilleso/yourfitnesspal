import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isOffline,
  reportNetworkFailure,
  reportNetworkSuccess,
  resetConnectivityForTests,
  retryConnection,
  startConnectivityRecovery,
  subscribeConnectivity,
} from "./connectivity";

const platform = vi.hoisted(() => ({ native: true }));

vi.mock("./platform", () => ({ isNative: () => platform.native }));

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  platform.native = true;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  resetConnectivityForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("connectivity state", () => {
  it("starts online and notifies only when the state changes", () => {
    const listener = vi.fn();
    subscribeConnectivity(listener);

    expect(isOffline()).toBe(false);

    reportNetworkFailure();
    reportNetworkFailure();
    expect(isOffline()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    reportNetworkSuccess();
    reportNetworkSuccess();
    expect(isOffline()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConnectivity(listener);

    unsubscribe();
    reportNetworkFailure();

    expect(listener).not.toHaveBeenCalled();
  });

  it("drives onlineManager with network failures and successes", () => {
    reportNetworkFailure();
    expect(onlineManager.isOnline()).toBe(false);

    reportNetworkSuccess();
    expect(onlineManager.isOnline()).toBe(true);
  });

  it("retryConnection puts onlineManager online without changing isOffline", () => {
    const listener = vi.fn();
    subscribeConnectivity(listener);
    reportNetworkFailure();

    retryConnection();

    expect(onlineManager.isOnline()).toBe(true);
    expect(isOffline()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("startConnectivityRecovery on the native platform", () => {
  it("calls setOnline(true) every 20 s only while offline", () => {
    vi.useFakeTimers();
    const setOnline = vi.spyOn(onlineManager, "setOnline");
    const stop = startConnectivityRecovery();

    vi.advanceTimersByTime(20000);
    expect(setOnline).not.toHaveBeenCalledWith(true);

    reportNetworkFailure();
    setOnline.mockClear();

    vi.advanceTimersByTime(19999);
    expect(setOnline).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(setOnline).toHaveBeenCalledWith(true);

    stop();
  });

  it("stops the interval and the listeners on cleanup", () => {
    vi.useFakeTimers();
    const setOnline = vi.spyOn(onlineManager, "setOnline");
    const stop = startConnectivityRecovery();
    reportNetworkFailure();

    stop();
    setOnline.mockClear();

    vi.advanceTimersByTime(60000);
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));

    expect(setOnline).not.toHaveBeenCalled();
  });

  it("retries when the app comes back to the foreground while offline", () => {
    const setOnline = vi.spyOn(onlineManager, "setOnline");
    const stop = startConnectivityRecovery();
    reportNetworkFailure();
    setOnline.mockClear();

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(setOnline).not.toHaveBeenCalled();

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(setOnline).toHaveBeenCalledWith(true);

    stop();
  });

  it("does not retry on foreground when online", () => {
    const setOnline = vi.spyOn(onlineManager, "setOnline");
    const stop = startConnectivityRecovery();
    setOnline.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(setOnline).not.toHaveBeenCalled();
    stop();
  });

  it("retries on the window online event", () => {
    const setOnline = vi.spyOn(onlineManager, "setOnline");
    const stop = startConnectivityRecovery();
    setOnline.mockClear();

    window.dispatchEvent(new Event("online"));

    expect(setOnline).toHaveBeenCalledWith(true);
    stop();
  });
});

describe("startConnectivityRecovery on the web", () => {
  it("registers nothing", () => {
    platform.native = false;
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const addWindowListener = vi.spyOn(window, "addEventListener");
    const addDocumentListener = vi.spyOn(document, "addEventListener");
    const setOnline = vi.spyOn(onlineManager, "setOnline");

    const stop = startConnectivityRecovery();
    stop();

    expect(setInterval).not.toHaveBeenCalled();
    expect(addWindowListener).not.toHaveBeenCalled();
    expect(addDocumentListener).not.toHaveBeenCalled();
    expect(setOnline).not.toHaveBeenCalled();
  });
});
