import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useHasPermission } from "../auth/AuthContext";
import { useSavedWeeks } from "../api/savedWeeks";
import PermissionGuard from "../auth/PermissionGuard";
import SavedWeeksPage from "./SavedWeeksPage";

vi.mock("../api/savedWeeks", () => ({ useSavedWeeks: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useHasPermission: vi.fn(() => false) }));
vi.mock("../components/ModeSwitch", () => ({ default: () => <div data-testid="mode-switch" /> }));

const weeks = [
  { id: 2, name: "Dieta B", created_at: "2026-10-05T10:00:00Z", entries_count: 12, avg_kcal: 1875.4 },
  { id: 1, name: "Dieta A", created_at: "2026-10-01T10:00:00Z", entries_count: 8, avg_kcal: 2010.2 },
];

function renderPage(path = "/week/saved") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<PermissionGuard permission="diary.copy" />}>
          <Route path="/week/saved" element={<SavedWeeksPage />} />
        </Route>
        <Route path="/" element={<p>Giorno</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SavedWeeksPage", () => {
  beforeEach(() => {
    vi.mocked(useHasPermission).mockReturnValue(true);
    vi.mocked(useSavedWeeks).mockReturnValue({
      data: weeks,
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useSavedWeeks>);
  });

  it("lists saved weeks with their summary in received order", () => {
    renderPage();

    const cards = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/week/saved/"));
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("href", "/week/saved/2");
    expect(cards[0]).toHaveTextContent("Dieta B");
    expect(cards[0]).toHaveTextContent("12 pasti");
    expect(cards[0]).toHaveTextContent("~1875 kcal/giorno");
    expect(cards[1]).toHaveAttribute("href", "/week/saved/1");
    expect(cards[1]).toHaveTextContent("Dieta A");
    expect(cards[1]).toHaveTextContent("8 pasti");
  });

  it("shows a link back to the week when the list is empty", () => {
    vi.mocked(useSavedWeeks).mockReturnValue({ data: [], isLoading: false, isError: false } as unknown as ReturnType<typeof useSavedWeeks>);
    renderPage();

    expect(screen.getByText("Nessuna settimana salvata.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vai a Settimana" })).toHaveAttribute("href", "/week");
  });

  it("redirects to the day when the user lacks the permission", () => {
    vi.mocked(useHasPermission).mockReturnValue(false);
    renderPage();

    expect(screen.getByText("Giorno")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Settimane salvate" })).not.toBeInTheDocument();
  });
});
