import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { useHasPermission, useMe } from "../auth/AuthContext";
import SettingsPage from "./SettingsPage";

vi.mock("../auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../auth/AuthContext")>("../auth/AuthContext");
  return { ...actual, useMe: vi.fn(), useHasPermission: vi.fn(() => false) };
});

vi.mock("../components/RestAlertSetting", () => ({
  default: () => <input type="checkbox" role="switch" aria-label="Avviso fine riposo" />,
}));

function renderAs(role: "user" | "admin", canUseWorkouts = false) {
  vi.mocked(useHasPermission).mockReturnValue(canUseWorkouts);
  vi.mocked(useMe).mockReturnValue({
    data: { id: 1, username: "alice", display_name: "Alice", role, permissions: [], mcp_url: "" },
  } as unknown as ReturnType<typeof useMe>);
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage />
    </MemoryRouter>,
  );
}

describe("SettingsPage", () => {
  it("links to the account page and has no goal form", () => {
    renderAs("user");
    expect(screen.getByRole("link", { name: /account/i })).toHaveAttribute("href", "/account");
    expect(screen.queryByLabelText(/calorie/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /gestione utenti/i })).not.toBeInTheDocument();
  });

  it("shows user management to admins", () => {
    renderAs("admin");
    expect(screen.getByRole("link", { name: /gestione utenti/i })).toHaveAttribute("href", "/admin/users");
  });

  it("does not show the settings gear on the settings page itself", () => {
    renderAs("user");
    expect(screen.queryByRole("link", { name: "Impostazioni" })).not.toBeInTheDocument();
  });

  it("shows the rest alert toggle when the user can use workouts", () => {
    renderAs("user", true);
    expect(screen.getByRole("switch", { name: "Avviso fine riposo" })).toBeInTheDocument();
  });

  it("hides the rest alert toggle when the user cannot use workouts", () => {
    renderAs("user", false);
    expect(screen.queryByRole("switch", { name: "Avviso fine riposo" })).not.toBeInTheDocument();
  });
});
