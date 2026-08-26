import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { client } from "../api/client";
import type { FoodBase } from "../api/queries";
import QuantityPicker, { scalePreview } from "./QuantityPicker";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    client: { ...actual.client, post: vi.fn() },
  };
});

const nutriments = {
  kcal: 80,
  protein_g: 4,
  carbs_g: 10,
  sugars_g: 2,
  fat_g: 2,
  sat_fat_g: 1,
  fiber_g: 1,
  salt_g: 0.1,
};

const food: FoodBase = {
  id: 42,
  name: "Yogurt greco",
  brand: "Fage",
  image_url: null,
  serving_size_g: 125,
  nutriments,
};

function renderPicker(overrides: Partial<React.ComponentProps<typeof QuantityPicker>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  const onAdded = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <QuantityPicker
        food={food}
        date="2026-08-26"
        meal="breakfast"
        onClose={onClose}
        onAdded={onAdded}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onAdded };
}

describe("scalePreview", () => {
  it("scales per-100g nutriments proportionally to grams", () => {
    expect(scalePreview(nutriments, 250)).toEqual({
      kcal: 200,
      protein_g: 10,
      carbs_g: 25,
      fat_g: 5,
    });
  });

  it("returns zeros for 0 grams", () => {
    expect(scalePreview(nutriments, 0)).toEqual({
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    });
  });
});

describe("QuantityPicker", () => {
  it("defaults grams to the food's serving size and shows the scaled preview", () => {
    renderPicker();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    expect(input.value).toBe("125");
    // 80 kcal/100g * 125g = 100 kcal
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("updates the live macro preview when the grams input changes", async () => {
    const user = userEvent.setup();
    renderPicker();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    await user.clear(input);
    await user.type(input, "250");

    // 80 kcal/100g * 250g = 200 kcal
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("sets grams to 100 when the 100g preset is clicked", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("button", { name: "100 g" }));

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    expect(input.value).toBe("100");
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("posts the entry with date/meal/food_id/grams and calls onAdded on confirm", async () => {
    vi.mocked(client.post).mockResolvedValue({});
    const user = userEvent.setup();
    const { onAdded } = renderPicker();

    await user.click(screen.getByRole("button", { name: /aggiungi/i }));

    expect(client.post).toHaveBeenCalledWith("/diary/entries", {
      date: "2026-08-26",
      meal: "breakfast",
      food_id: 42,
      grams: 125,
    });
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalled());
  });

  it("calls onClose when Annulla is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPicker();

    await user.click(screen.getByRole("button", { name: /annulla/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
