import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

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

describe("AuthGuard on the web platform when the server is unreachable", () => {
  it("shows the unreachable message and a retry button on a network error", async () => {
    vi.mocked(getMe).mockRejectedValue(new TypeError("Failed to fetch"));

    renderWithRouter("/");

    await waitFor(() => {
      expect(screen.getByText("Impossibile contattare il server")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Riprova" })).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected Home")).not.toBeInTheDocument();
  });

  it("calls getMe again when the user clicks retry", async () => {
    vi.mocked(getMe).mockReset();
    vi.mocked(getMe).mockRejectedValue(new TypeError("Failed to fetch"));

    renderWithRouter("/");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Riprova" })).toBeInTheDocument();
    });
    expect(getMe).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Riprova" }));

    await waitFor(() => {
      expect(getMe).toHaveBeenCalledTimes(2);
    });
  });

  it("shows the loading placeholder until getMe answers", async () => {
    vi.mocked(getMe).mockReset();
    vi.mocked(getMe).mockReturnValue(new Promise(() => undefined));

    renderWithRouter("/");

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Impossibile contattare il server")).not.toBeInTheDocument();
  });
});
