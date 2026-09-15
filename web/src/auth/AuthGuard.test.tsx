import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { getMe } from "../api/auth";
import AuthGuard from "./AuthGuard";

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth");
  return {
    ...actual,
    getMe: vi.fn(),
  };
});

function renderWithRouter(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route element={<AuthGuard />}>
            <Route path="/" element={<div>Protected Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AuthGuard", () => {
  it("redirects an unauthenticated user to /login", async () => {
    vi.mocked(getMe).mockRejectedValue(new ApiError(401, "unauthorized", { detail: "unauthorized" }));

    renderWithRouter("/");

    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
    expect(screen.queryByText("Protected Home")).not.toBeInTheDocument();
  });

  it("renders the protected route for an authenticated user", async () => {
    vi.mocked(getMe).mockResolvedValue({
      id: 1, username: "alice", display_name: "Alice", role: "user", permissions: [],
    });

    renderWithRouter("/");

    await waitFor(() => {
      expect(screen.getByText("Protected Home")).toBeInTheDocument();
    });
  });
});
