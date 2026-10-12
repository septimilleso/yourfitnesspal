import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logout } from "../api/auth";
import * as pushModule from "../lib/push";
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

const logoutMock = vi.mocked(logout);
const useNavigateMock = vi.mocked(useNavigate);
const unsubscribeDeviceOnLogoutMock = vi.mocked(pushModule.unsubscribeDeviceOnLogout);
const cancelRestNotificationMock = vi.mocked(cancelRestNotification);

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
  return { logout: result.current, navigate };
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
});
