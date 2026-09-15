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

function renderLoginPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Day Home</div>} />
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
});
