import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { client } from "../api/client";
import type { DiaryEntry } from "../api/queries";
import EditEntrySheet from "./EditEntrySheet";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    client: { ...actual.client, patch: vi.fn() },
  };
});

const entry: DiaryEntry = {
  id: 7,
  food_id: 100,
  food_name: "Yogurt greco",
  food_brand: "Fage",
  date: "2026-08-26",
  meal: "breakfast",
  grams: 200,
  portion_label: null,
  position: 0,
  nutriments_snapshot: {
    kcal: 80,
    protein_g: 4,
    carbs_g: 10,
    sugars_g: 2,
    fat_g: 2,
    sat_fat_g: 1,
    fiber_g: 1,
    salt_g: 0.1,
  },
};

function renderSheet(overrides: Partial<React.ComponentProps<typeof EditEntrySheet>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <EditEntrySheet entry={entry} onClose={onClose} {...overrides} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe("EditEntrySheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefills grams and the current meal, and shows the scaled preview", () => {
    renderSheet();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    expect(input.value).toBe("200");
    // 80 kcal/100g * 200g = 160
    expect(screen.getByText("160")).toBeInTheDocument();
    // current meal pill is pressed
    expect(screen.getByRole("button", { name: "Colazione" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("rescales the macro preview when grams change", async () => {
    const user = userEvent.setup();
    renderSheet();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    await user.clear(input);
    await user.type(input, "300");

    // 80 * 300 / 100 = 240
    expect(screen.getByText("240")).toBeInTheDocument();
  });

  it("selects another meal pill", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("button", { name: "Cena" }));

    expect(screen.getByRole("button", { name: "Cena" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Colazione" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("patches the entry with id, grams and meal, then calls onClose", async () => {
    vi.mocked(client.patch).mockResolvedValue({});
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    await user.clear(input);
    await user.type(input, "250");
    await user.click(screen.getByRole("button", { name: "Pranzo" }));
    await user.click(screen.getByRole("button", { name: /salva/i }));

    expect(client.patch).toHaveBeenCalledWith("/diary/entries/7", {
      grams: 250,
      meal: "lunch",
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("disables Salva and shows an error when grams is 0 or negative", async () => {
    const user = userEvent.setup();
    renderSheet();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    await user.clear(input);
    await user.type(input, "0");

    expect(screen.getByRole("alert")).toHaveTextContent(/quantità valida/i);
    expect(screen.getByRole("button", { name: /salva/i })).toBeDisabled();

    fireEvent.change(input, { target: { value: "-5" } });
    expect(screen.getByRole("button", { name: /salva/i })).toBeDisabled();
  });

  it("shows an error and keeps the sheet open when the patch fails", async () => {
    vi.mocked(client.patch).mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    await user.click(screen.getByRole("button", { name: /salva/i }));

    expect(await screen.findByText(/errore durante il salvataggio/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables Salva while the patch is in flight", async () => {
    let resolvePatch!: (value: unknown) => void;
    vi.mocked(client.patch).mockReturnValue(
      new Promise((resolve) => {
        resolvePatch = resolve;
      }),
    );
    const user = userEvent.setup();
    renderSheet();

    const salva = screen.getByRole("button", { name: /salva/i });
    await user.click(salva);

    expect(salva).toBeDisabled();

    resolvePatch({});
  });

  it("calls onClose when Annulla is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    await user.click(screen.getByRole("button", { name: /annulla/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
