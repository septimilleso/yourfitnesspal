import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { listConnections, revokeConnection } from "../api/oauth";
import McpConnectionsSection from "./McpConnectionsSection";

vi.mock("../api/oauth", () => ({ listConnections: vi.fn(), revokeConnection: vi.fn() }));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><McpConnectionsSection mcpUrl="https://fit.example.com/mcp" /></QueryClientProvider>);
}

describe("McpConnectionsSection", () => {
  it("shows the MCP URL and revokes a connection", async () => {
    vi.mocked(listConnections).mockResolvedValue([
      { client_id: "cid-1", client_name: "Claude", connected_at: "2026-09-01T10:00:00Z", last_used_at: null },
    ]);
    vi.mocked(revokeConnection).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByText("https://fit.example.com/mcp")).toBeInTheDocument();
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /revoca/i }));

    expect(revokeConnection).toHaveBeenCalledWith("cid-1");
  });

  it("says when nothing is connected", async () => {
    vi.mocked(listConnections).mockResolvedValue([]);
    renderSection();

    expect(await screen.findByText(/nessun assistente collegato/i)).toBeInTheDocument();
  });
});
