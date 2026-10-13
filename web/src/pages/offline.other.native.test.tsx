import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listSessions, type Me, type Session } from "../api/auth";
import { useRecentFoods } from "../api/queries";
import { useHasPermission, useLogout, useMe } from "../auth/AuthContext";
import { createQueryClient } from "../lib/queryClient";
import {
  reportNetworkFailure,
  reportNetworkSuccess,
  resetConnectivityForTests,
  retryConnection,
} from "../native/connectivity";
import { pausedQuery, retryingQuery } from "../test/offlineQuery";
import AccountPage from "./AccountPage";
import SearchPage from "./SearchPage";

vi.mock("../native/platform", () => ({ isNative: () => true }));
vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return {
    ...actual,
    useRecentFoods: vi.fn(),
  };
});
vi.mock("../components/Scanner", () => ({
  default: () => <div data-testid="scanner-stub" />,
}));
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

const UNAVAILABLE = "Non disponibile offline";
const LOADING = "Caricamento...";

const me: Me = { id: 1, username: "simone", display_name: "Simone", role: "user", permissions: [], mcp_url: "" };

const session: Session = {
  id: 1,
  created_at: "2026-10-01T10:00:00Z",
  last_seen_at: "2026-10-13T08:00:00Z",
  user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)",
  ip: null,
  current: true,
};

let queryClient: QueryClient | undefined;

function renderSearch() {
  queryClient = createQueryClient(true);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/search?date=2026-08-26&meal=breakfast"]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderAccount() {
  queryClient = createQueryClient(true);
  // Con mount() React Query riparte alla ripresa della rete, come nell'IPA.
  queryClient.mount();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useMe).mockReturnValue({ data: me } as unknown as ReturnType<typeof useMe>);
  vi.mocked(useLogout).mockReturnValue(vi.fn());
  vi.mocked(useHasPermission).mockReturnValue(false);
});

afterEach(() => {
  queryClient?.unmount();
  queryClient = undefined;
  resetConnectivityForTests();
});

describe("SearchPage Recenti offline", () => {
  function mockRecent(query: object) {
    vi.mocked(useRecentFoods).mockReturnValue(query as unknown as ReturnType<typeof useRecentFoods>);
  }

  it("con la query in pausa offline mostra Non disponibile offline al posto di Nessun alimento recente", () => {
    reportNetworkFailure();
    mockRecent(pausedQuery());

    renderSearch();

    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByText("Aprila con la rete per averla anche offline.")).toBeInTheDocument();
    expect(screen.queryByText("Nessun alimento recente.")).not.toBeInTheDocument();
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
  });

  it("con la query di nuovo in fetching offline il messaggio resta e Caricamento non compare", () => {
    reportNetworkFailure();
    mockRecent(retryingQuery());

    renderSearch();

    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
  });

  it("con la rete presente e la query in fetching mostra Caricamento e non il messaggio", () => {
    reportNetworkSuccess();
    mockRecent(retryingQuery());

    renderSearch();

    expect(screen.getByText(LOADING)).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("con la rete presente la query in pausa non mostra il messaggio offline", () => {
    reportNetworkSuccess();
    mockRecent(pausedQuery());

    renderSearch();

    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
    expect(screen.getByText("Nessun alimento recente.")).toBeInTheDocument();
  });
});

describe("AccountPage sessioni offline", () => {
  beforeEach(() => {
    vi.mocked(listSessions).mockReturnValue(new Promise<Session[]>(() => {}));
  });

  it("offline la sezione Sessioni attive mostra Non disponibile offline e il logout resta", () => {
    reportNetworkFailure();

    renderAccount();

    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Esci" })).toBeInTheDocument();
    // Offline la query va in pausa: nessuna richiesta parte.
    expect(listSessions).not.toHaveBeenCalled();
  });

  it("durante un tentativo di ripresa il messaggio resta e Caricamento non compare", async () => {
    reportNetworkFailure();
    renderAccount();

    retryConnection();

    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(1));
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByText(LOADING)).not.toBeInTheDocument();
  });

  it("con la rete presente mostra Caricamento mentre le sessioni arrivano", () => {
    reportNetworkSuccess();

    renderAccount();

    expect(screen.getByText(LOADING)).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("online con le sessioni caricate non mostra il messaggio", async () => {
    reportNetworkSuccess();
    vi.mocked(listSessions).mockResolvedValue([session]);

    renderAccount();

    expect(await screen.findByText("Questa sessione")).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });
});
