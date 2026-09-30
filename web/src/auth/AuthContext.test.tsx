import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logout } from "../api/auth";
import { useLogout } from "./AuthContext";

vi.mock("../api/auth", () => ({ getMe: vi.fn(), logout: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: vi.fn() };
});

const logoutMock = vi.mocked(logout);
const useNavigateMock = vi.mocked(useNavigate);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useLogout", () => {
  it("logs out, clears client caches, then navigates to login", async () => {
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, "clear");
    const deleteCache = vi.fn().mockResolvedValue(true);
    const navigate = vi.fn();
    vi.stubGlobal("caches", { delete: deleteCache });
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

    expect(logoutMock).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("api-foods-cache");
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(logoutMock.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0]);
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(deleteCache.mock.invocationCallOrder[0]);
    expect(deleteCache.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]);
  });
});
