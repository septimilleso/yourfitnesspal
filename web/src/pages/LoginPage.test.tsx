import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { login, verifyTotp } from "../api/auth";
import LoginPage from "./LoginPage";

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth");
  return {
    ...actual,
    login: vi.fn(),
    verifyTotp: vi.fn(),
  };
});

function renderLoginPage(url = "/login") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Day Home</div>} />
          <Route path="/connect" element={<div>Connect Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("navigates to / after credentials and a successful TOTP check", async () => {
    vi.mocked(login).mockResolvedValue({ status: "totp_required" });
    vi.mocked(verifyTotp).mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(screen.getByLabelText(/^password$/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /accedi/i }));

    expect(login).toHaveBeenCalledWith("alice", "correct-password");
    await user.type(await screen.findByLabelText(/codice autenticatore/i), "123456");
    await user.click(screen.getByRole("button", { name: /verifica/i }));

    expect(await screen.findByText("Day Home")).toBeInTheDocument();
    expect(verifyTotp).toHaveBeenCalledWith({ code: "123456" });
  });

  it("shows an error message when login fails", async () => {
    vi.mocked(login).mockRejectedValue(new ApiError(401, "unauthorized", { detail: "unauthorized" }));
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(screen.getByLabelText(/^password$/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /accedi/i }));

    expect(await screen.findByText(/unauthorized/i)).toBeInTheDocument();
    expect(screen.queryByText("Day Home")).not.toBeInTheDocument();
  });

  async function loginWithTotp(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/username/i), "alice");
    await user.type(screen.getByLabelText(/^password$/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /accedi/i }));
    await user.type(await screen.findByLabelText(/codice autenticatore/i), "123456");
    await user.click(screen.getByRole("button", { name: /verifica/i }));
  }

  it("returns to an internal next path after login", async () => {
    vi.mocked(login).mockResolvedValue({ status: "totp_required" });
    vi.mocked(verifyTotp).mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    renderLoginPage("/login?next=%2Fconnect%3Freq%3Dabc");

    await loginWithTotp(user);

    expect(await screen.findByText("Connect Page")).toBeInTheDocument();
  });

  it("ignores an external next URL", async () => {
    vi.mocked(login).mockResolvedValue({ status: "totp_required" });
    vi.mocked(verifyTotp).mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();
    renderLoginPage("/login?next=https%3A%2F%2Fevil.example");

    await loginWithTotp(user);

    expect(await screen.findByText("Day Home")).toBeInTheDocument();
  });
});
