import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTemplate, type Template } from "../../api/gym";
import TemplatePreviewSheet from "./TemplatePreviewSheet";

vi.mock("../../api/gym", async () => {
  const actual = await vi.importActual<typeof import("../../api/gym")>("../../api/gym");
  return { ...actual, useTemplate: vi.fn() };
});

const squat = {
  id: 7,
  name: "Barbell Squat",
  equipment: "barbell",
  primary_muscles: ["quadriceps"],
  secondary_muscles: [],
  category: "strength",
  tracking: "weight_reps" as const,
  custom: false,
};

const template: Template = {
  id: 1,
  name: "Push A",
  folder_id: null,
  last_used_at: null,
  exercises: [
    {
      id: 11,
      exercise: squat,
      rest_seconds: 90,
      superset_group: null,
      note: null,
      sets: [{ weight_kg: 60, reps: 8, duration_s: null }],
    },
  ],
};

function mockTemplate(value: Partial<ReturnType<typeof useTemplate>>) {
  vi.mocked(useTemplate).mockReturnValue({ isLoading: false, isError: false, ...value } as ReturnType<typeof useTemplate>);
}

function renderSheet() {
  return render(
    <TemplatePreviewSheet templateId={1} starting={false} onStart={vi.fn()} onEdit={vi.fn()} onClose={vi.fn()} />,
  );
}

describe("TemplatePreviewSheet", () => {
  beforeEach(() => {
    mockTemplate({ data: template });
  });

  it("shows a loading message and keeps the start button disabled", () => {
    mockTemplate({ isLoading: true });
    renderSheet();
    expect(screen.getByText("Caricamento...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inizia allenamento" })).toBeDisabled();
  });

  it("lists the exercises of the template", () => {
    renderSheet();
    expect(screen.getByText("Barbell Squat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inizia allenamento" })).toBeEnabled();
  });
});
