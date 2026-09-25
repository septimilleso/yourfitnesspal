import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHasPermission } from "../auth/AuthContext";
import AppShell from "./AppShell";

vi.mock("../auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../auth/AuthContext")>("../auth/AuthContext");
  return { ...actual, useHasPermission: vi.fn(() => false) };
});

vi.mock("./gym/ActiveWorkoutBar", () => ({
  default: () => <div data-testid="active-workout-bar" />,
}));

function renderShell(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>Giorno Page</div>} />
          <Route path="/search" element={<div>Search Page</div>} />
          <Route path="/week" element={<div>Week Page</div>} />
          <Route path="/settings" element={<div>Settings Page</div>} />
          <Route path="/gym" element={<div>Gym Page</div>} />
          <Route path="/gym/history" element={<div>History Page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(useHasPermission).mockReturnValue(false);
  });

  it("renders a nav bar with all 4 tabs as real links", () => {
    renderShell();

    expect(screen.getByRole("navigation", { name: /navigazione principale/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Giorno" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Cerca" })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: "Settimana" })).toHaveAttribute("href", "/week");
    expect(screen.getByRole("link", { name: "Impostazioni" })).toHaveAttribute("href", "/settings");
  });

  it("renders the current page's content via the outlet", () => {
    renderShell();

    expect(screen.getByText("Giorno Page")).toBeInTheDocument();
  });

  it("renders the diet pixel-art tab icons", () => {
    renderShell();

    expect(screen.getByRole("link", { name: "Giorno" }).querySelector("img")).toHaveAttribute(
      "src",
      "/art/diet/icons/plate.png",
    );
  });

  it("keeps the nav bar visible on the search page", () => {
    renderShell("/search");

    expect(screen.getByText("Search Page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settimana" })).toBeInTheDocument();
  });

  it("navigates to /week when Settimana is clicked", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("link", { name: "Settimana" }));

    expect(screen.getByText("Week Page")).toBeInTheDocument();
  });

  it("pads the nav bar past the iOS home indicator instead of sitting on it", () => {
    renderShell();

    const nav = screen.getByRole("navigation", { name: /navigazione principale/i });
    // `env(safe-area-inset-bottom)` is mirrored into `--safe-bottom` (see
    // index.css) and applied as the bar's own bottom padding. Without it the
    // tab labels render underneath the iPhone's home-indicator bar in the
    // installed PWA -- unreadable, and the bottom ~20px of taps land on the
    // system gesture area instead of the tabs.
    expect(nav).toHaveClass("pb-[var(--safe-bottom)]");
  });

  it("marks the active tab", () => {
    renderShell("/week");

    expect(screen.getByRole("link", { name: "Settimana" })).toHaveClass("text-brand-600");
    expect(screen.getByRole("link", { name: "Giorno" })).toHaveClass("text-slate-400");
  });

  it("shows the gym tabs on gym pages", () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    renderShell("/gym");

    expect(screen.getByRole("link", { name: "Storico" })).toHaveAttribute("href", "/gym/history");
    expect(screen.getByRole("link", { name: "Inizia" })).toHaveAttribute("href", "/gym");
    expect(screen.getByRole("link", { name: "Esercizi" })).toHaveAttribute("href", "/gym/exercises");
    expect(screen.getByRole("link", { name: "Impostazioni" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("link", { name: "Giorno" })).not.toBeInTheDocument();
    expect(screen.getByTestId("active-workout-bar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inizia" }).querySelector("img")).toHaveAttribute(
      "src",
      "/art/gym/icons/dumbbell.png",
    );
  });

  it("keeps the gym tabs on settings after visiting the gym", async () => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    const user = userEvent.setup();
    renderShell("/gym");

    await user.click(screen.getByRole("link", { name: "Impostazioni" }));

    expect(screen.getByText("Settings Page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Storico" })).toBeInTheDocument();
  });
});
