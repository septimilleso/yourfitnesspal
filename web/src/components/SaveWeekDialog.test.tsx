import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { useSaveWeek } from "../api/savedWeeks";
import SaveWeekDialog from "./SaveWeekDialog";

vi.mock("../api/savedWeeks", () => ({
  useSaveWeek: vi.fn(),
}));

const mutate = vi.fn();
const reset = vi.fn();

function setupMocks(overrides: Partial<ReturnType<typeof useSaveWeek>> = {}) {
  vi.mocked(useSaveWeek).mockReturnValue({
    mutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
    reset,
    ...overrides,
  } as unknown as ReturnType<typeof useSaveWeek>);
}

describe("SaveWeekDialog", () => {
  beforeEach(() => {
    mutate.mockClear();
    reset.mockClear();
  });

  it("submits the trimmed name and start date", async () => {
    setupMocks();
    const user = userEvent.setup();
    render(<SaveWeekDialog start="2026-10-12" onClose={vi.fn()} />);

    await user.type(screen.getByLabelText("Nome"), "  Dieta A  ");
    await user.click(screen.getByRole("button", { name: "Salva" }));

    expect(mutate).toHaveBeenCalledWith(
      { name: "Dieta A", start: "2026-10-12" },
      expect.any(Object),
    );
  });

  it("disables save when the name is empty or only whitespace", async () => {
    setupMocks();
    const user = userEvent.setup();
    render(<SaveWeekDialog start="2026-10-12" onClose={vi.fn()} />);
    const saveButton = screen.getByRole("button", { name: "Salva" });

    expect(saveButton).toBeDisabled();
    await user.type(screen.getByLabelText("Nome"), "   ");
    expect(saveButton).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows the API error message", () => {
    setupMocks({ isError: true, error: new ApiError(400, "La settimana non ha nessun pasto", {}) });
    render(<SaveWeekDialog start="2026-10-12" onClose={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("La settimana non ha nessun pasto");
  });

  it("shows a fallback for non-API errors", () => {
    setupMocks({ isError: true, error: new Error("unexpected") });
    render(<SaveWeekDialog start="2026-10-12" onClose={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Errore durante il salvataggio della settimana.",
    );
  });

  it("calls onSaved after success and closes from the success state", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    setupMocks();
    const user = userEvent.setup();
    const { rerender } = render(
      <SaveWeekDialog start="2026-10-12" onClose={onClose} onSaved={onSaved} />,
    );

    await user.type(screen.getByLabelText("Nome"), "Dieta A");
    await user.click(screen.getByRole("button", { name: "Salva" }));
    const options = mutate.mock.calls[0]?.[1] as { onSuccess?: () => void };
    options.onSuccess?.();

    expect(onSaved).toHaveBeenCalled();
    setupMocks({ isSuccess: true });
    rerender(<SaveWeekDialog start="2026-10-12" onClose={onClose} onSaved={onSaved} />);
    expect(screen.getByRole("status")).toHaveTextContent("Settimana salvata.");
    await user.click(screen.getByRole("button", { name: "Chiudi" }));

    expect(reset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on cancel", async () => {
    setupMocks();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SaveWeekDialog start="2026-10-12" onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Annulla" }));

    expect(reset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
