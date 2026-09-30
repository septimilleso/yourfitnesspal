import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logout } from "../api/auth";
import * as pushModule from "../lib/push";
import { useLogout } from "./AuthContext";

vi.mock("../api/auth", () => ({ getMe: vi.fn(), logout: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: vi.fn() };
});
vi.mock("../lib/push", () => ({ unsubscribeDeviceOnLogout: vi.fn() }));

const logoutMock = vi.mocked(logout);
const useNavigateMock = vi.mocked(useNavigate);
const unsubscribeDeviceOnLogoutMock = vi.mocked(pushModule.unsubscribeDeviceOnLogout);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useLogout", () => {
  it("unsubscribes device, logs out, clears client caches, then navigates to login", async () => {
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, "clear");
    const deleteCache = vi.fn().mockResolvedValue(true);
    const navigate = vi.fn();
    vi.stubGlobal("caches", { delete: deleteCache });
    unsubscribeDeviceOnLogoutMock.mockResolvedValue(undefined);
    logoutMock.mockResolvedValue(undefined);
    useNavigateMock.mockReturnValue(navigate);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current();
    });

    expect(unsubscribeDeviceOnLogoutMock).toHaveBeenCalledOnce();
    expect(logoutMock).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("api-foods-cache");
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(unsubscribeDeviceOnLogoutMock.mock.invocationCallOrder[0]).toBeLessThan(
      logoutMock.mock.invocationCallOrder[0]
    );
    expect(logoutMock.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0]);
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(deleteCache.mock.invocationCallOrder[0]);
    expect(deleteCache.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
  });

  it("completes logout and navigates even if unsubscribeDeviceOnLogout rejects", async () => {
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, "clear");
    const deleteCache = vi.fn().mockResolvedValue(true);
    const navigate = vi.fn();
    vi.stubGlobal("caches", { delete: deleteCache });
    unsubscribeDeviceOnLogoutMock.mockRejectedValue(new Error("Network error"));
    logoutMock.mockResolvedValue(undefined);
    useNavigateMock.mockReturnValue(navigate);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useLogout(), { wrapper });

    await act(async () => {
      await result.current();
    });

    expect(unsubscribeDeviceOnLogoutMock).toHaveBeenCalledOnce();
    expect(logoutMock).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("api-foods-cache");
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});
