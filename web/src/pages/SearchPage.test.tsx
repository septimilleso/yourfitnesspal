import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { client } from "../api/client";
import SearchPage from "./SearchPage";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    client: { ...actual.client, get: vi.fn() },
  };
});

// The scanner touches getUserMedia/camera APIs which are out of scope for
// this page's own tests -- Scanner.test.tsx covers it in isolation.
vi.mock("../components/Scanner", () => ({
  default: () => <div data-testid="scanner-stub" />,
}));

function food(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    barcode: null,
    name: "Acqua Naturale",
    brand: "FonteViva",
    image_url: null,
    serving_size_g: null,
    nutriments: {
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      sugars_g: 0,
      fat_g: 0,
      sat_fat_g: 0,
      fiber_g: 0,
      salt_g: 0,
    },
    source: "cache",
    ...overrides,
  };
}

function renderPage(initialPath = "/search?date=2026-08-26&meal=breakfast") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(client.get).mockImplementation((path: string) => {
    if (path.startsWith("/foods/recent")) return Promise.resolve({ results: [] });
    if (path.startsWith("/foods/search")) return Promise.resolve({ results: [] });
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// A little over the component's internal 350ms debounce.
const DEBOUNCE_MS_BUFFER = 400;

describe("SearchPage debounce", () => {
  it("fires exactly one /foods/search request, for the final query, after the typing pause", async () => {
    vi.useFakeTimers();
    renderPage();

    const input = screen.getByLabelText(/cerca un alimento/i);

    fireEvent.change(input, { target: { value: "a" } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.change(input, { target: { value: "ac" } });
    await vi.advanceTimersByTimeAsync(100);
    fireEvent.change(input, { target: { value: "acqua" } });

    // Not yet debounced -- no search call fired.
    let searchCalls = vi.mocked(client.get).mock.calls.filter(([p]) => String(p).startsWith("/foods/search"));
    expect(searchCalls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS_BUFFER);

    searchCalls = vi.mocked(client.get).mock.calls.filter(([p]) => String(p).startsWith("/foods/search"));
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0][0]).toBe("/foods/search?q=acqua&limit=20");
  });
});

describe("SearchPage results", () => {
  it("shows the Recenti tab by default, backed by GET /foods/recent", async () => {
    vi.mocked(client.get).mockImplementation((path: string) => {
      if (path.startsWith("/foods/recent")) {
        return Promise.resolve({ results: [food({ id: 9, name: "Pane integrale", brand: null })] });
      }
      return Promise.resolve({ results: [] });
    });

    renderPage();

    expect(await screen.findByText("Pane integrale")).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledWith("/foods/recent");
  });

  it("shows a source badge (OFF vs cache) on each result", async () => {
    vi.mocked(client.get).mockImplementation((path: string) => {
      if (path.startsWith("/foods/recent")) {
        return Promise.resolve({
          results: [
            food({ id: 1, name: "Local Food", source: "cache" }),
            food({ id: 2, name: "OFF Food", source: "off" }),
          ],
        });
      }
      return Promise.resolve({ results: [] });
    });

    renderPage();

    await screen.findByText("Local Food");
    expect(screen.getByText("OFF")).toBeInTheDocument();
    expect(screen.getByText("cache")).toBeInTheDocument();
  });

  it("switches to the Preferiti tab and shows its placeholder", async () => {
    renderPage();
    await screen.findByRole("tab", { name: "Preferiti" });

    fireEvent.click(screen.getByRole("tab", { name: "Preferiti" }));

    expect(screen.getByText(/preferiti arriveranno/i)).toBeInTheDocument();
  });

  it("opens the QuantityPicker when a result is clicked", async () => {
    vi.mocked(client.get).mockImplementation((path: string) => {
      if (path.startsWith("/foods/recent")) {
        return Promise.resolve({ results: [food({ id: 5, name: "Mela" })] });
      }
      return Promise.resolve({ results: [] });
    });

    renderPage();

    fireEvent.click(await screen.findByText("Mela"));

    expect(await screen.findByRole("dialog", { name: /quantità per mela/i })).toBeInTheDocument();
  });
});
