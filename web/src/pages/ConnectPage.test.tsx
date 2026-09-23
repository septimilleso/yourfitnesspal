import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMe } from "../api/auth";
import { ApiError } from "../api/client";
import { decideConsent, getConsent } from "../api/oauth";
import { redirectTo } from "../lib/redirect";
import ConnectPage from "./ConnectPage";

vi.mock("../api/auth", async () => {
  const actual = await vi.importActual<typeof import("../api/auth")>("../api/auth");
  return { ...actual, getMe: vi.fn() };
});
vi.mock("../api/oauth", () => ({ getConsent: vi.fn(), decideConsent: vi.fn() }));
vi.mock("../lib/redirect", () => ({ redirectTo: vi.fn() }));

const ME = {
  id: 1, username: "alice", display_name: "Alice", role: "user" as const,
  permissions: ["mcp.access" as const], mcp_url: "https://fit.example.com/mcp",
};
const CONSENT = {
  client_name: "Claude", redirect_host: "claude.ai",
  user: { username: "alice", display_name: "Alice" }, has_permission: true,
};

function LoginProbe() {
  const location = useLocation();
  return <div>Login {location.search}</div>;
}

function renderAt(url: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConnectPage", () => {
  beforeEach(() => {
    vi.mocked(getMe).mockResolvedValue(ME);
    vi.mocked(getConsent).mockResolvedValue(CONSENT);
    vi.mocked(decideConsent).mockReset();
    vi.mocked(redirectTo).mockReset();
  });

  it("approves and sends the browser back to the client", async () => {
    vi.mocked(decideConsent).mockResolvedValue({ redirect_url: "https://claude.ai/cb?code=x" });
    const user = userEvent.setup();
    renderAt("/connect?req=abc");

    await user.click(await screen.findByRole("button", { name: /autorizza/i }));

    expect(decideConsent).toHaveBeenCalledWith("abc", true);
    await vi.waitFor(() => expect(redirectTo).toHaveBeenCalledWith("https://claude.ai/cb?code=x"));
  });

  it("denies", async () => {
    vi.mocked(decideConsent).mockResolvedValue({ redirect_url: "https://claude.ai/cb?error=access_denied" });
    const user = userEvent.setup();
    renderAt("/connect?req=abc");

    await user.click(await screen.findByRole("button", { name: /nega/i }));

    expect(decideConsent).toHaveBeenCalledWith("abc", false);
  });

  it("explains a missing permission and offers only cancel", async () => {
    vi.mocked(getConsent).mockResolvedValue({ ...CONSENT, has_permission: false });
    renderAt("/connect?req=abc");

    expect(await screen.findByText(/chiedi all.amministratore/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /autorizza/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /annulla/i })).toBeInTheDocument();
  });

  it("reports an expired request", async () => {
    vi.mocked(getConsent).mockRejectedValue(new ApiError(400, "richiesta scaduta", null));
    renderAt("/connect?req=abc");

    expect(await screen.findByText(/richiesta scaduta/i)).toBeInTheDocument();
  });

  it("sends anonymous users to login and back", async () => {
    vi.mocked(getMe).mockRejectedValue(new ApiError(401, "unauthorized", null));
    renderAt("/connect?req=abc");

    expect(await screen.findByText("Login ?next=%2Fconnect%3Freq%3Dabc")).toBeInTheDocument();
  });
});
