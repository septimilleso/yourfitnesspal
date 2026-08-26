import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError, login } from "../api/client";
import LoginPage from "./LoginPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    login: vi.fn(),
  };
});

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Day Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("navigates to / after a successful login", async () => {
    vi.mocked(login).mockResolvedValue({ status: "ok" });
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByLabelText(/key/i), "correct-key");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText("Day Home")).toBeInTheDocument();
    expect(login).toHaveBeenCalledWith("correct-key");
  });

  it("shows an error message when login fails", async () => {
    vi.mocked(login).mockRejectedValue(new ApiError(401, "unauthorized", { detail: "unauthorized" }));
    const user = userEvent.setup();

    renderLoginPage();

    await user.type(screen.getByLabelText(/key/i), "wrong-key");
    await user.click(screen.getByRole("button", { name: /log in/i }));

    expect(await screen.findByText(/unauthorized/i)).toBeInTheDocument();
    expect(screen.queryByText("Day Home")).not.toBeInTheDocument();
  });
});
