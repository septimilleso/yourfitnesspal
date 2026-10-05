import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CopyDaysResponse } from "../api/queries";
import { useApplySavedWeek } from "../api/savedWeeks";
import ApplySavedWeekDialog from "./ApplySavedWeekDialog";

vi.mock("../api/savedWeeks", () => ({
  useApplySavedWeek: vi.fn(),
}));

const mutate = vi.fn();
const reset = vi.fn();

function setupMocks(overrides: Partial<ReturnType<typeof useApplySavedWeek>> = {}) {
  vi.mocked(useApplySavedWeek).mockReturnValue({
    mutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
    reset,
    ...overrides,
  } as unknown as ReturnType<typeof useApplySavedWeek>);
}

describe("ApplySavedWeekDialog", () => {
  beforeEach(() => {
    mutate.mockClear();
    reset.mockClear();
  });

  it("submits all meals as null and the selected days", async () => {
    setupMocks();
    const user = userEvent.setup();
    render(
      <ApplySavedWeekDialog savedWeekId={12} days={[1, 3]} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/data di inizio/i), "2026-10-12");
    await user.click(screen.getByRole("button", { name: /^applica$/i }));

    expect(mutate).toHaveBeenCalledWith({
      id: 12,
      days: [1, 3],
      target_start: "2026-10-12",
      meals: null,
      mode: "append",
    });
  });

  it("submits a meal subset and replace mode", async () => {
    setupMocks();
    const user = userEvent.setup();
    render(
      <ApplySavedWeekDialog savedWeekId={7} days={null} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/data di inizio/i), "2026-10-12");
    await user.click(screen.getByLabelText("Cena"));
    await user.click(screen.getByLabelText(/sostituisci/i));
    await user.click(screen.getByRole("button", { name: /^applica$/i }));

    expect(mutate).toHaveBeenCalledWith({
      id: 7,
      days: null,
      target_start: "2026-10-12",
      meals: ["breakfast", "lunch", "snack"],
      mode: "replace",
    });
  });

  it("disables apply without a date or when no meals are selected", async () => {
    setupMocks();
    const user = userEvent.setup();
    const { rerender } = render(
      <ApplySavedWeekDialog savedWeekId={7} days={null} onClose={vi.fn()} />,
    );
    const applyButton = screen.getByRole("button", { name: /^applica$/i });

    expect(applyButton).toBeDisabled();
    await user.type(screen.getByLabelText(/data di inizio/i), "2026-10-12");
    for (const meal of ["Colazione", "Pranzo", "Cena", "Spuntino"]) {
      await user.click(screen.getByLabelText(meal));
    }
    expect(applyButton).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();

    rerender(
      <ApplySavedWeekDialog savedWeekId={7} days={null} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("dialog", { name: "Applica settimana" })).toBeInTheDocument();
  });

  it("shows the success summary and closes after reset", async () => {
    const response: CopyDaysResponse = {
      entries_created: 5,
      days: [
        { date: "2026-10-12", entries_created: 3 },
        { date: "2026-10-13", entries_created: 2 },
      ],
    };
    setupMocks({ isSuccess: true, data: response });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ApplySavedWeekDialog savedWeekId={7} days={[1, 3]} onClose={onClose} />);

    expect(screen.getByRole("status")).toHaveTextContent("Applicati 5 pasti in 2 giorni.");
    await user.click(screen.getByRole("button", { name: "Chiudi" }));

    expect(reset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an application error and closes on cancel", async () => {
    setupMocks({ isError: true });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ApplySavedWeekDialog savedWeekId={7} days={null} onClose={onClose} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Errore durante l'applicazione della settimana.",
    );
    await user.click(screen.getByRole("button", { name: "Annulla" }));

    expect(reset).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
