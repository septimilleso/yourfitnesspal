import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { CopyDaysResponse } from "../api/queries";
import { useCopyDays } from "../api/queries";
import CopyDaysDialog from "./CopyDaysDialog";

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return {
    ...actual,
    useCopyDays: vi.fn(),
  };
});

const mutate = vi.fn();
const reset = vi.fn();

function setupMocks(overrides: Partial<ReturnType<typeof useCopyDays>> = {}) {
  vi.mocked(useCopyDays).mockReturnValue({
    mutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
    reset,
    ...overrides,
  } as unknown as ReturnType<typeof useCopyDays>);
}

describe("CopyDaysDialog", () => {
  beforeEach(() => {
    mutate.mockClear();
    reset.mockClear();
  });

  it("submits a request body built from the selected days and form state", async () => {
    setupMocks();
    const user = userEvent.setup();
    render(
      <CopyDaysDialog sourceDates={["2026-08-24", "2026-08-25"]} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/data di inizio/i), "2026-09-01");
    // Uncheck "Cena" and "Spuntino" to exercise the meal-filter subset path.
    await user.click(screen.getByLabelText("Cena"));
    await user.click(screen.getByLabelText("Spuntino"));
    await user.click(screen.getByLabelText(/sostituisci/i));
    await user.click(screen.getByRole("button", { name: /^copia$/i }));

    expect(mutate).toHaveBeenCalledWith({
      source_dates: ["2026-08-24", "2026-08-25"],
      target_start: "2026-09-01",
      meals: ["breakfast", "lunch"],
      mode: "replace",
    });
  });

  it("sends meals: null when all meal checkboxes stay checked (default)", async () => {
    setupMocks();
    const user = userEvent.setup();
    render(<CopyDaysDialog sourceDates={["2026-08-24"]} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/data di inizio/i), "2026-09-01");
    await user.click(screen.getByRole("button", { name: /^copia$/i }));

    expect(mutate).toHaveBeenCalledWith({
      source_dates: ["2026-08-24"],
      target_start: "2026-09-01",
      meals: null,
      mode: "append",
    });
  });

  it("shows a success summary with the entry count from the mutation response", () => {
    const response: CopyDaysResponse = {
      entries_created: 5,
      days: [
        { date: "2026-09-01", entries_created: 3 },
        { date: "2026-09-02", entries_created: 2 },
      ],
    };
    setupMocks({ isSuccess: true, data: response });
    render(<CopyDaysDialog sourceDates={["2026-08-24"]} onClose={vi.fn()} />);

    expect(screen.getByText(/5/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/5/);
  });

  it("calls onClose when Annulla is clicked", async () => {
    setupMocks();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CopyDaysDialog sourceDates={["2026-08-24"]} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /annulla/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
