import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import MealSection from "./MealSection";

describe("MealSection", () => {
  it("shows the pixel-art icon for the meal", () => {
    render(
      <MemoryRouter>
        <MealSection
          meal="breakfast"
          date="2026-09-25"
          entries={[]}
          onEdit={() => {}}
          onDelete={() => {}}
          deletingId={null}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Colazione" }).querySelector("img")).toHaveAttribute(
      "src",
      "/art/diet/icons/egg.png",
    );
  });
});
