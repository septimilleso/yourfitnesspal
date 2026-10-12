import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logout } from "../api/auth";
import * as pushModule from "../lib/push";
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

const logoutMock = vi.mocked(logout);
const useNavigateMock = vi.mocked(useNavigate);
const unsubscribeDeviceOnLogoutMock = vi.mocked(pushModule.unsubscribeDeviceOnLogout);

beforeEach(async () => {
  platform.native = true;
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  await clearToken();
  vi.clearAllMocks();
  unsubscribeDeviceOnLogoutMock.mockResolvedValue(undefined);
  logoutMock.mockResolvedValue(undefined);
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

describe("useLogout on the native platform", () => {
  it("calls the server logout, removes the token, then navigates to login", async () => {
    await setToken("tok-logout");
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(logoutMock).toHaveBeenCalledOnce();
    expect(preferences.remove).toHaveBeenCalledWith({ key: "yfp.session" });
    expect(getToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(logoutMock.mock.invocationCallOrder[0]).toBeLessThan(
      preferences.remove.mock.invocationCallOrder[0],
    );
  });

  it("removes the token and navigates even if the server logout rejects", async () => {
    await setToken("tok-offline");
    logoutMock.mockRejectedValue(new Error("Network error"));
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await expect(runLogout()).resolves.toBeUndefined();
    });

    expect(preferences.remove).toHaveBeenCalledWith({ key: "yfp.session" });
    expect(getToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
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
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});
