import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Goal } from "../api/queries";
import { useGoal, usePutGoal } from "../api/queries";
import { useHasPermission } from "../auth/AuthContext";
import GoalForm from "./GoalForm";

vi.mock("../api/queries", async () => {
  const actual = await vi.importActual<typeof import("../api/queries")>("../api/queries");
  return {
    ...actual,
    useGoal: vi.fn(),
    usePutGoal: vi.fn(),
  };
});

vi.mock("../auth/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../auth/AuthContext")>("../auth/AuthContext");
  return {
    ...actual,
    useHasPermission: vi.fn(),
  };
});

function renderGoalForm() {
  return render(<GoalForm />, { wrapper: MemoryRouter });
}

const goal: Goal = {
  id: 1,
  kcal: 2000,
  protein_g: 150,
  carbs_g: 250,
  fat_g: 70,
  valid_from: "2026-01-01",
};

const mutate = vi.fn();

function setupMocks(overrides: Partial<ReturnType<typeof useGoal>> = {}) {
  vi.mocked(useGoal).mockReturnValue({
    data: goal,
    isLoading: false,
    isError: false,
    ...overrides,
  } as ReturnType<typeof useGoal>);
  vi.mocked(usePutGoal).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof usePutGoal>);
  vi.mocked(useHasPermission).mockReturnValue(true);
}

describe("GoalForm", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("renders normalized percentages and read-only gram previews", () => {
    setupMocks();
    renderGoalForm();

    expect(screen.getByLabelText(/calorie/i)).toHaveValue(2000);
    expect(screen.getByLabelText(/proteine/i)).toHaveValue(27);
    expect(screen.getByLabelText(/carboidrati/i)).toHaveValue(45);
    expect(screen.getByLabelText(/grassi/i)).toHaveValue(28);
    expect(screen.getByText("135 g")).toBeInTheDocument();
    expect(screen.getByText("225 g")).toBeInTheDocument();
    expect(screen.getByText("62 g")).toBeInTheDocument();
  });

  it("submits calculated grams using the existing payload shape", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderGoalForm();

    await user.clear(screen.getByLabelText(/calorie/i));
    await user.type(screen.getByLabelText(/calorie/i), "2200");
    await user.clear(screen.getByLabelText(/proteine/i));
    await user.type(screen.getByLabelText(/proteine/i), "35");
    await user.clear(screen.getByLabelText(/carboidrati/i));
    await user.type(screen.getByLabelText(/carboidrati/i), "35");
    await user.clear(screen.getByLabelText(/grassi/i));
    await user.type(screen.getByLabelText(/grassi/i), "30");
    await user.click(screen.getByRole("button", { name: /salva/i }));

    expect(mutate).toHaveBeenCalledWith(
      { kcal: 2200, protein_g: 193, carbs_g: 193, fat_g: 73 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("blocks saving when percentages do not total 100", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderGoalForm();

    await user.clear(screen.getByLabelText(/carboidrati/i));
    await user.type(screen.getByLabelText(/carboidrati/i), "44");

    expect(screen.getByRole("button", { name: /salva/i })).toBeDisabled();
    expect(screen.getByText(/somma.*100/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("renders an empty form when no goal exists yet", () => {
    setupMocks({ data: null });
    renderGoalForm();

    expect(screen.getByLabelText(/calorie/i)).toHaveValue(null);
    expect(screen.getByLabelText(/proteine/i)).toHaveValue(null);
  });

  it("requires percentages when existing macro grams are all zero", () => {
    setupMocks({
      data: { ...goal, protein_g: 0, carbs_g: 0, fat_g: 0 },
    });
    renderGoalForm();

    expect(screen.getByLabelText(/proteine/i)).toHaveValue(null);
    expect(screen.getByLabelText(/carboidrati/i)).toHaveValue(null);
    expect(screen.getByLabelText(/grassi/i)).toHaveValue(null);
    expect(screen.getByRole("button", { name: /salva/i })).toBeDisabled();
  });

  it("shows a success confirmation after a successful save", async () => {
    setupMocks();
    mutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.();
    });
    const user = userEvent.setup();
    renderGoalForm();

    await user.click(screen.getByRole("button", { name: /salva/i }));

    expect(screen.getByRole("status")).toHaveTextContent(/salvato/i);
  });
});
