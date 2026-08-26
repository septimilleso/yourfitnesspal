import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { client } from "../api/client";
import CustomFoodForm from "./CustomFoodForm";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    client: { ...actual.client, post: vi.fn() },
  };
});

function renderForm(onCreated: (food: unknown) => void = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomFoodForm onCreated={onCreated as never} />
    </QueryClientProvider>,
  );
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Torta fatta in casa" } });
  fireEvent.change(screen.getByLabelText("Calorie (kcal)"), { target: { value: "310" } });
  fireEvent.change(screen.getByLabelText("Proteine (g)"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Carboidrati (g)"), { target: { value: "40" } });
  fireEvent.change(screen.getByLabelText("di cui zuccheri (g)"), { target: { value: "22" } });
  fireEvent.change(screen.getByLabelText("Grassi (g)"), { target: { value: "14" } });
  fireEvent.change(screen.getByLabelText("di cui saturi (g)"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("Fibre (g)"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Sale (g)"), { target: { value: "0.5" } });
}

describe("CustomFoodForm", () => {
  it("submits POST /foods with the full 8-field nutriment payload", async () => {
    vi.mocked(client.post).mockResolvedValue({
      id: 42,
      barcode: null,
      source: "custom",
      name: "Torta fatta in casa",
      brand: null,
      image_url: null,
      serving_size_g: null,
      nutriments: {
        kcal: 310,
        protein_g: 5,
        carbs_g: 40,
        sugars_g: 22,
        fat_g: 14,
        sat_fat_g: 7,
        fiber_g: 2,
        salt_g: 0.5,
      },
    });

    renderForm();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /crea alimento/i }));

    await screen.findByRole("button", { name: /crea alimento/i });

    expect(client.post).toHaveBeenCalledWith("/foods", {
      name: "Torta fatta in casa",
      brand: null,
      serving_size_g: null,
      image_url: null,
      nutriments: {
        kcal: 310,
        protein_g: 5,
        carbs_g: 40,
        sugars_g: 22,
        fat_g: 14,
        sat_fat_g: 7,
        fiber_g: 2,
        salt_g: 0.5,
      },
    });
  });

  it("calls onCreated with the newly-created food on success", async () => {
    const created = {
      id: 42,
      barcode: null,
      source: "custom",
      name: "Torta fatta in casa",
      brand: null,
      image_url: null,
      serving_size_g: null,
      nutriments: {
        kcal: 310,
        protein_g: 5,
        carbs_g: 40,
        sugars_g: 22,
        fat_g: 14,
        sat_fat_g: 7,
        fiber_g: 2,
        salt_g: 0.5,
      },
    };
    vi.mocked(client.post).mockResolvedValue(created);
    const onCreated = vi.fn();

    renderForm(onCreated);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /crea alimento/i }));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  });

  it("shows an error message when the create request fails", async () => {
    vi.mocked(client.post).mockRejectedValue(new Error("boom"));

    renderForm();
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /crea alimento/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/errore/i);
  });
});
