import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Goal } from "../api/queries";
import { useGoal, usePutGoal } from "../api/queries";
import { useHasPermission, useMe } from "../auth/AuthContext";
import SettingsPage from "./SettingsPage";

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
    useMe: vi.fn(),
    useHasPermission: vi.fn(),
  };
});

function renderSettingsPage() {
  return render(<SettingsPage />, { wrapper: MemoryRouter });
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
  vi.mocked(useMe).mockReturnValue({
    data: { id: 1, username: "alice", display_name: "Alice", role: "user", permissions: ["goals.edit"] },
  } as unknown as ReturnType<typeof useMe>);
  vi.mocked(useHasPermission).mockReturnValue(true);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("renders pre-filled values from the existing goal", () => {
    setupMocks();
    renderSettingsPage();

    expect(screen.getByLabelText(/calorie/i)).toHaveValue(2000);
    expect(screen.getByLabelText(/proteine/i)).toHaveValue(150);
    expect(screen.getByLabelText(/carboidrati/i)).toHaveValue(250);
    expect(screen.getByLabelText(/grassi/i)).toHaveValue(70);
  });

  it("submits the mutation with the edited payload shape", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderSettingsPage();

    await user.clear(screen.getByLabelText(/calorie/i));
    await user.type(screen.getByLabelText(/calorie/i), "2200");
    await user.click(screen.getByRole("button", { name: /salva/i }));

    expect(mutate).toHaveBeenCalledWith(
      { kcal: 2200, protein_g: 150, carbs_g: 250, fat_g: 70 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("renders an empty form when no goal exists yet", () => {
    setupMocks({ data: null });
    renderSettingsPage();

    expect(screen.getByLabelText(/calorie/i)).toHaveValue(null);
  });

  it("shows a success confirmation after a successful save", async () => {
    setupMocks();
    mutate.mockImplementation((_input, opts) => {
      opts?.onSuccess?.();
    });
    const user = userEvent.setup();
    renderSettingsPage();

    await user.click(screen.getByRole("button", { name: /salva/i }));

    expect(screen.getByRole("status")).toHaveTextContent(/salvato/i);
  });
});
