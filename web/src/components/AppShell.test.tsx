import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import AppShell from "./AppShell";

function renderShell(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>Giorno Page</div>} />
          <Route path="/search" element={<div>Search Page</div>} />
          <Route path="/week" element={<div>Week Page</div>} />
          <Route path="/settings" element={<div>Settings Page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
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
});
