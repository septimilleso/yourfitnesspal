import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logout } from "../api/auth";
import { cancelRestNotification } from "../native/restNotifications";
import { clearToken } from "../native/session";
import { useLogout } from "./AuthContext";

const platform = vi.hoisted(() => ({ native: true }));

vi.mock("../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("../native/session", () => ({ clearToken: vi.fn() }));
vi.mock("../native/restNotifications", () => ({ cancelRestNotification: vi.fn() }));
vi.mock("../api/auth", () => ({ getMe: vi.fn(), logout: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: vi.fn() };
});
vi.mock("../lib/push", () => ({ unsubscribeDeviceOnLogout: vi.fn() }));

const logoutMock = vi.mocked(logout);
const useNavigateMock = vi.mocked(useNavigate);
const cancelMock = vi.mocked(cancelRestNotification);
const clearTokenMock = vi.mocked(clearToken);

beforeEach(() => {
  vi.clearAllMocks();
  platform.native = true;
  logoutMock.mockResolvedValue(undefined);
  cancelMock.mockResolvedValue(undefined);
  clearTokenMock.mockResolvedValue(undefined);
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
  return { logout: result.current };
}

describe("useLogout cancels the rest notification", () => {
  it("cancels the pending rest notification before the server logout on native", async () => {
    const { logout: runLogout } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(cancelMock).toHaveBeenCalledOnce();
    expect(cancelMock.mock.invocationCallOrder[0]).toBeLessThan(logoutMock.mock.invocationCallOrder[0]);
  });

  it("still logs out when the cancel rejects", async () => {
    cancelMock.mockRejectedValue(new Error("plugin error"));
    const { logout: runLogout } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(logoutMock).toHaveBeenCalledOnce();
    expect(clearTokenMock).toHaveBeenCalledOnce();
  });

  it("does not touch rest notifications on the web platform", async () => {
    platform.native = false;
    const { logout: runLogout } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(cancelMock).not.toHaveBeenCalled();
    expect(logoutMock).toHaveBeenCalledOnce();
  });
});
