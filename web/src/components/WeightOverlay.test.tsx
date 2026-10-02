import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSaveWeight, useTodayWeight } from "../api/weights";
import WeightOverlay from "./WeightOverlay";

vi.mock("../api/weights", () => ({
  useTodayWeight: vi.fn(),
  useSaveWeight: vi.fn(),
}));

const mutate = vi.fn();
const onClose = vi.fn();

function setup({
  todayWeight = null,
  isPending = false,
}: {
  todayWeight?: { weight_kg: number } | null;
  isPending?: boolean;
} = {}) {
  vi.mocked(useTodayWeight).mockReturnValue({ data: todayWeight } as ReturnType<typeof useTodayWeight>);
  vi.mocked(useSaveWeight).mockReturnValue({ mutate, isPending } as unknown as ReturnType<typeof useSaveWeight>);
  return render(<WeightOverlay mode="diet" onClose={onClose} />);
}

describe("WeightOverlay", () => {
  beforeEach(() => {
    mutate.mockReset();
    onClose.mockReset();
    vi.useRealTimers();
  });

  it("parses comma decimals and closes after a successful save", async () => {
    mutate.mockImplementation((_value, options) => options?.onSuccess?.());
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Peso in kg" }), "78,4");
    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(mutate).toHaveBeenCalledWith(78.4, expect.objectContaining({ onSuccess: expect.any(Function) }));
    expect(screen.getByRole("status")).toHaveTextContent("Peso salvato");
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce(), { timeout: 1500 });
  });

  it("pre-fills today's weight when it loads", () => {
    setup({ todayWeight: { weight_kg: 78.4 } });
    expect(screen.getByRole("textbox", { name: "Peso in kg" })).toHaveValue("78,4");
  });

  it.each(["abc", "15"])("rejects invalid value %s without saving", async (value) => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Peso in kg" }), value);
    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Inserisci un peso tra 20 e 400 kg");
    expect(mutate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the overlay open and shows an error when saving fails", async () => {
    mutate.mockImplementation((_value, options) => options?.onError?.(new Error("offline")));
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Peso in kg" }), "78");
    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Impossibile salvare il peso. Riprova.");
    expect(screen.getByRole("textbox", { name: "Peso in kg" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes without saving when requested", async () => {
    setup();
    await userEvent.setup().click(screen.getByRole("button", { name: "Chiudi" }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    setup();
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("uses the section artwork and a decimal input", () => {
    const { rerender } = setup();
    expect(screen.getByTestId("weight-scene").style.backgroundImage).toContain("/art/diet/weight.webp");
    expect(screen.getByRole("textbox", { name: "Peso in kg" })).toHaveAttribute("inputmode", "decimal");

    rerender(<WeightOverlay mode="gym" onClose={onClose} />);
    expect(screen.getByTestId("weight-scene").style.backgroundImage).toContain("/art/gym/weight.webp");
  });

  it("disables saving while the request is pending", async () => {
    setup({ isPending: true });
    expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled();
  });

  it("prevents duplicate submissions while a save is in progress", async () => {
    setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Peso in kg" }), "78");
    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(screen.getByRole("button", { name: "Salva" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Salva" }));
    expect(mutate).toHaveBeenCalledOnce();
  });
});
