import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BadgeGrid from "./BadgeGrid";

describe("BadgeGrid", () => {
  it("shows only the latest earned badge by default", () => {
    render(<BadgeGrid mode="diet" current={12} />);

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Badge 2" })).toBeInTheDocument();
    expect(screen.getByText("Ultimo badge sbloccato")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /bloccato$/ })).not.toBeInTheDocument();
  });

  it("shows the first locked badge before any badges are earned", () => {
    render(<BadgeGrid mode="diet" current={3} />);

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Badge 1 bloccato" })).toBeInTheDocument();
    expect(screen.getByText("Primo badge a 5 giorni di fila")).toBeInTheDocument();
  });

  it("toggles the full badge collection", () => {
    render(<BadgeGrid mode="diet" current={12} />);

    const showAllButton = screen.getByRole("button", { name: "Mostra tutti i badge" });
    expect(showAllButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(showAllButton);

    const hideButton = screen.getByRole("button", { name: "Nascondi badge" });
    expect(hideButton).toHaveAttribute("aria-expanded", "true");
    const grid = screen.getByRole("list");
    expect(within(grid).getAllByRole("img")).toHaveLength(30);
    expect(screen.queryByText("Ultimo badge sbloccato")).not.toBeInTheDocument();

    fireEvent.click(hideButton);

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText("Ultimo badge sbloccato")).toBeInTheDocument();
  });
});
