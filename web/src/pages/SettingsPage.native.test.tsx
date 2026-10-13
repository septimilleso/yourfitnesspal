import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHasPermission, useMe } from "../auth/AuthContext";
import SettingsPage from "./SettingsPage";

const platform = vi.hoisted(() => ({ native: true }));
const filesystem = vi.hoisted(() => ({ stat: vi.fn() }));

vi.mock("../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));

vi.mock("../auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../auth/AuthContext")>("../auth/AuthContext");
  return { ...actual, useMe: vi.fn(), useHasPermission: vi.fn(() => false) };
});

vi.mock("../components/NativeRestAlertSetting", () => ({
  default: () => <div>versione nativa</div>,
}));
vi.mock("../components/RestAlertSetting", () => ({
  default: () => <div>versione web</div>,
}));

function renderSettings() {
  vi.mocked(useHasPermission).mockReturnValue(false);
  vi.mocked(useMe).mockReturnValue({
    data: { id: 1, username: "alice", display_name: "Alice", role: "user", permissions: [], mcp_url: "" },
  } as unknown as ReturnType<typeof useMe>);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Data fissa: solo Date è finta, i timer restano reali.
const NOW = new Date(2026, 9, 13, 16, 30);

beforeEach(() => {
  platform.native = true;
  filesystem.stat.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SettingsPage nell'IPA", () => {
  it("mostra peso e ora del file della cache offline", async () => {
    filesystem.stat.mockResolvedValue({ size: 430080, mtime: new Date(2026, 9, 13, 14, 5).getTime() });
    renderSettings();
    expect(await screen.findByText("Dati offline: circa 420 KB, salvati alle 14:05")).toBeInTheDocument();
    expect(filesystem.stat).toHaveBeenCalledWith({ path: "yfp/query-cache.json", directory: "LIBRARY" });
  });

  it("mostra il giorno quando i dati non sono di oggi", async () => {
    filesystem.stat.mockResolvedValue({ size: 430080, mtime: new Date(2026, 9, 12, 14, 5).getTime() });
    renderSettings();
    expect(await screen.findByText("Dati offline: circa 420 KB, salvati il 12/10 alle 14:05")).toBeInTheDocument();
  });

  it("mostra 'nessuno' se il file non si può leggere", async () => {
    filesystem.stat.mockRejectedValue(new Error("File does not exist"));
    renderSettings();
    expect(await screen.findByText("Dati offline: nessuno")).toBeInTheDocument();
  });

  it("non mostra la riga sul web e non legge il file", async () => {
    platform.native = false;
    renderSettings();
    expect(screen.getByRole("link", { name: /account/i })).toBeInTheDocument();
    expect(screen.queryByText(/Dati offline/)).not.toBeInTheDocument();
    expect(filesystem.stat).not.toHaveBeenCalled();
  });
});
