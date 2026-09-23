import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminUser } from "../../api/admin";
import { client } from "../../api/client";
import UserAccessPanel from "./UserAccessPanel";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const USER: AdminUser = {
  id: 2, username: "bob", display_name: "Bob", role: "user", permissions: ["goals.edit"],
  is_active: true, totp_enabled: true, must_change_password: false, locked_until: null,
  last_login_at: null, created_at: "2026-09-01T10:00:00Z", active_sessions: 0,
};

function renderPanel(user: AdminUser = USER) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><UserAccessPanel user={user} /></QueryClientProvider>);
}

describe("UserAccessPanel", () => {
  beforeEach(() => {
    // Cast: `client.get` is generic (<T>(path) => Promise<T>), the fake is not.
    vi.mocked(client.get).mockImplementation((async (path: string) => {
      if (path === "/admin/permissions") return [
        { key: "goals.edit", label: "Modifica gli obiettivi", default: true },
        { key: "mcp.access", label: "Connessioni AI (MCP)", default: false },
      ];
      if (path === "/admin/users/2/mcp-connections") return [
        { client_id: "cid-1", client_name: "Claude", connected_at: "2026-09-01T10:00:00Z", last_used_at: null },
      ];
      throw new Error(`unexpected GET ${path}`);
    }) as typeof client.get);
    vi.mocked(client.patch).mockResolvedValue({ ...USER, permissions: ["goals.edit", "mcp.access"] });
    vi.mocked(client.delete).mockResolvedValue(undefined);
  });

  it("grants a permission", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByLabelText("Connessioni AI (MCP)"));

    expect(client.patch).toHaveBeenCalledWith("/admin/users/2", { permissions: ["goals.edit", "mcp.access"] });
  });

  it("revokes all AI connections", async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText(/Claude/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /revoca tutte/i }));

    expect(client.delete).toHaveBeenCalledWith("/admin/users/2/mcp-connections");
  });

  it("does not offer permission toggles for admins", async () => {
    renderPanel({ ...USER, role: "admin" });

    expect(await screen.findByText(/gli amministratori hanno tutti i permessi/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
