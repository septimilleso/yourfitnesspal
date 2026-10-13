import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listSessions, type Me, type Session } from "../api/auth";
import { useHasPermission, useLogout, useMe } from "../auth/AuthContext";
import AccountPage from "./AccountPage";

vi.mock("../auth/AuthContext", () => ({
  useMe: vi.fn(),
  useLogout: vi.fn(),
  useHasPermission: vi.fn(),
}));
vi.mock("../components/ModeSwitch", () => ({ default: () => null }));
vi.mock("../components/McpConnectionsSection", () => ({ default: () => null }));
vi.mock("../api/auth", () => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  changePassword: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
}));

const me: Me = { id: 1, username: "simone", display_name: "Simone", role: "user", permissions: [], mcp_url: "" };

const session: Session = {
  id: 1,
  created_at: "2026-10-01T10:00:00Z",
  last_seen_at: "2026-10-13T08:00:00Z",
  user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)",
  ip: null,
  current: true,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AccountPage sessions", () => {
  beforeEach(() => {
    vi.mocked(useMe).mockReturnValue({ data: me } as unknown as ReturnType<typeof useMe>);
    vi.mocked(useLogout).mockReturnValue(vi.fn());
    vi.mocked(useHasPermission).mockReturnValue(false);
    vi.mocked(listSessions).mockResolvedValue([]);
  });

  it("shows a loading message while the sessions load", () => {
    vi.mocked(listSessions).mockReturnValue(new Promise<Session[]>(() => {}));
    renderPage();
    expect(screen.getByText("Caricamento...")).toBeInTheDocument();
  });

  it("shows an error message when the sessions fail to load", async () => {
    vi.mocked(listSessions).mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByText("Impossibile caricare le sessioni.")).toBeInTheDocument();
  });

  it("marks the current session", async () => {
    vi.mocked(listSessions).mockResolvedValue([session]);
    renderPage();
    expect(await screen.findByText("Questa sessione")).toBeInTheDocument();
    expect(screen.getByText("iPhone / iPad")).toBeInTheDocument();
  });
});
