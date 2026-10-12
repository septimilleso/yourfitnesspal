import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logout } from "../api/auth";
import { client } from "../api/client";
import * as pushModule from "../lib/push";
import { clearPersistedQueryCache } from "../native/queryPersistence";
import { cancelRestNotification } from "../native/restNotifications";
import { clearToken, getToken, setToken } from "../native/session";
import { useLogout } from "./AuthContext";

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
const platform = vi.hoisted(() => ({ native: true }));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("../api/auth", () => ({ getMe: vi.fn(), logout: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: vi.fn() };
});
vi.mock("../lib/push", () => ({ unsubscribeDeviceOnLogout: vi.fn() }));
vi.mock("../native/restNotifications", () => ({
  cancelRestNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../native/queryPersistence", () => ({
  clearPersistedQueryCache: vi.fn().mockResolvedValue(undefined),
}));

const logoutMock = vi.mocked(logout);
const useNavigateMock = vi.mocked(useNavigate);
const unsubscribeDeviceOnLogoutMock = vi.mocked(pushModule.unsubscribeDeviceOnLogout);
const cancelRestNotificationMock = vi.mocked(cancelRestNotification);
const clearPersistedQueryCacheMock = vi.mocked(clearPersistedQueryCache);

beforeEach(async () => {
  platform.native = true;
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  await clearToken();
  vi.clearAllMocks();
  unsubscribeDeviceOnLogoutMock.mockResolvedValue(undefined);
  logoutMock.mockResolvedValue(undefined);
  cancelRestNotificationMock.mockResolvedValue(undefined);
  clearPersistedQueryCacheMock.mockResolvedValue(undefined);
});

function renderLogout() {
  const queryClient = new QueryClient();
  const navigate = vi.fn();
  useNavigateMock.mockReturnValue(navigate);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useLogout(), { wrapper });
  return { logout: result.current, navigate, queryClient };
}

describe("useLogout on the native platform: pending rest notification", () => {
  it("cancels the rest notification before the server logout, then navigates to login", async () => {
    await setToken("tok-logout");
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(cancelRestNotificationMock).toHaveBeenCalled();
    expect(logoutMock).toHaveBeenCalledOnce();
    expect(cancelRestNotificationMock.mock.invocationCallOrder[0]).toBeLessThan(
      logoutMock.mock.invocationCallOrder[0],
    );
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(getToken()).toBeNull();
  });

  // C8: una notifica programmata dopo la prima cancellazione non deve suonare dopo l'uscita.
  it("cancels the rest notification again after the client caches are cleared", async () => {
    await setToken("tok-logout");
    const { logout: runLogout, navigate, queryClient } = renderLogout();
    const clearSpy = vi.spyOn(queryClient, "clear");

    await act(async () => {
      await runLogout();
    });

    expect(cancelRestNotificationMock).toHaveBeenCalledTimes(2);
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(cancelRestNotificationMock.mock.invocationCallOrder[1]).toBeGreaterThan(
      clearSpy.mock.invocationCallOrder[0],
    );
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("still navigates to login when the rest notification cancel rejects", async () => {
    await setToken("tok-logout");
    cancelRestNotificationMock.mockRejectedValue(new Error("notification plugin down"));
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await expect(runLogout()).resolves.toBeUndefined();
    });

    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(getToken()).toBeNull();
  });
});

describe("useLogout on the native platform: persisted cache and token", () => {
  // C7: il logout lato server fallisce (rete assente), ma la cache su file e il token vanno cancellati.
  it("clears the persisted cache and the token, then navigates, even if the server logout rejects", async () => {
    await setToken("tok-offline");
    logoutMock.mockRejectedValue(new Error("Network error"));
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await expect(runLogout()).resolves.toBeUndefined();
    });

    expect(clearPersistedQueryCacheMock).toHaveBeenCalledOnce();
    expect(getToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    // Vincolo d'ordine: il token va rimosso prima della cache su file.
    expect(preferences.remove.mock.invocationCallOrder[0]).toBeLessThan(
      clearPersistedQueryCacheMock.mock.invocationCallOrder[0],
    );
  });

  // C9: se Preferences non riesce a rimuovere il token, il logout deve arrivare comunque in fondo.
  it("keeps the token cleared in memory when the Preferences removal rejects", async () => {
    await setToken("tok-logout");
    preferences.remove.mockRejectedValue(new Error("preferences unavailable"));
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await expect(runLogout()).resolves.toBeUndefined();
    });

    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(getToken()).toBeNull();

    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    await client.get("/x").catch(() => undefined);
    vi.unstubAllGlobals();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).not.toHaveProperty("Authorization");
  });
});

describe("useLogout on the web platform", () => {
  it("does not touch the native session", async () => {
    platform.native = false;
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(logoutMock).toHaveBeenCalledOnce();
    expect(preferences.remove).not.toHaveBeenCalled();
    expect(clearPersistedQueryCacheMock).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});
