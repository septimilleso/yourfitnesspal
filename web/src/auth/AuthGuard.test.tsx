import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { checkAuth } from "../api/client";
import AuthGuard from "./AuthGuard";

vi.mock("../api/client", () => ({
  checkAuth: vi.fn(),
}));

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route element={<AuthGuard />}>
          <Route path="/" element={<div>Protected Home</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AuthGuard", () => {
  it("redirects an unauthenticated user to /login", async () => {
    vi.mocked(checkAuth).mockResolvedValue(false);

    renderWithRouter("/");

    await waitFor(() => {
      expect(screen.getByText("Login Page")).toBeInTheDocument();
    });
    expect(screen.queryByText("Protected Home")).not.toBeInTheDocument();
  });

  it("renders the protected route for an authenticated user", async () => {
    vi.mocked(checkAuth).mockResolvedValue(true);

    renderWithRouter("/");

    await waitFor(() => {
      expect(screen.getByText("Protected Home")).toBeInTheDocument();
    });
  });
});
