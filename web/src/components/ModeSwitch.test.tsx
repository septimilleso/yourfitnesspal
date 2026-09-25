import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHasPermission } from "../auth/AuthContext";
import ModeSwitch from "./ModeSwitch";

vi.mock("../auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../auth/AuthContext")>("../auth/AuthContext");
  return { ...actual, useHasPermission: vi.fn() };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ModeSwitch />
    </MemoryRouter>,
  );
}

describe("ModeSwitch", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows only the settings gear without the gym permission", () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    renderAt("/");
    expect(screen.queryByRole("group", { name: "Sezione" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Impostazioni" })).toHaveAttribute("href", "/settings");
  });

  it("renders nothing without gym permission on settings", () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    const { container } = renderAt("/settings");
    expect(container).toBeEmptyDOMElement();
  });

  it("uses the gym gear icon in the gym section", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    renderAt("/gym");
    expect(screen.getByRole("link", { name: "Impostazioni" }).querySelector("img")).toHaveAttribute(
      "src",
      "/art/gym/icons/gear.png",
    );
  });

  it("links to the other section's last page", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    window.localStorage.setItem("yfp.lastPath.gym", "/gym/history");
    renderAt("/");
    expect(screen.getByRole("link", { name: "Dieta" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Palestra" })).toHaveAttribute("href", "/gym/history");
  });
});
