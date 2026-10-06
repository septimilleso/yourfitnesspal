import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TemplateSummary } from "../../api/gym";
import ActionMenu from "./ActionMenu";
import TemplateCard from "./TemplateCard";

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;
let nav: HTMLElement | null = null;

function rect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function mockLayout({
  trigger,
  menu = { width: 224, height: 190 },
}: {
  trigger: { top: number; bottom: number; left: number; right: number };
  menu?: { width: number; height: number };
}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute("role") === "menu") {
      return rect(0, 0, menu.width, menu.height);
    }
    const triggerButton = document.querySelector('button[aria-label^="Azioni "]');
    if (this === triggerButton || this === triggerButton?.parentElement) {
      return rect(trigger.top, trigger.left, trigger.right - trigger.left, trigger.bottom - trigger.top);
    }
    if (this.tagName === "NAV" && nav) {
      return rect(600, 0, 390, 100);
    }
    return rect(0, 0, 0, 0);
  });
}

function renderActionMenu(onSelect = vi.fn()) {
  render(
    <ActionMenu
      label="Azioni test"
      actions={[
        { label: "Modifica", onSelect },
        { label: "Elimina", onSelect: vi.fn() },
      ]}
    />,
  );
  return { onSelect };
}

describe("ActionMenu positioning", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    nav?.remove();
    nav = null;
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
  });

  it("opens a template card menu above the trigger near the bottom", () => {
    const handler = vi.fn();
    const template: TemplateSummary = {
      id: 1,
      name: "Push",
      folder_id: null,
      last_used_at: null,
      exercise_names: ["Panca"],
    };
    mockLayout({ trigger: { top: 580, bottom: 610, left: 340, right: 380 } });
    render(
      <TemplateCard
        template={template}
        onOpen={handler}
        onEdit={handler}
        onDuplicate={handler}
        onMove={handler}
        onDelete={handler}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Azioni Push" }));

    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("data-placement", "top");
    expect(menu).toHaveAttribute("data-align", "right");
    expect(menu).toHaveClass("bottom-full");
    expect(menu).not.toHaveClass("mt-1");
  });

  it("keeps the menu below and right-aligned when there is room", () => {
    mockLayout({ trigger: { top: 100, bottom: 130, left: 340, right: 380 } });
    renderActionMenu();

    fireEvent.click(screen.getByRole("button", { name: "Azioni test" }));

    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("data-placement", "bottom");
    expect(menu).toHaveAttribute("data-align", "right");
    expect(menu).toHaveClass("mt-1");
    expect(menu).toHaveClass("right-0");
  });

  it("aligns the menu left when the trigger is near the left edge", () => {
    mockLayout({ trigger: { top: 100, bottom: 130, left: 8, right: 170 } });
    renderActionMenu();

    fireEvent.click(screen.getByRole("button", { name: "Azioni test" }));

    const menu = screen.getByRole("menu");
    expect(menu).toHaveAttribute("data-align", "left");
    expect(menu).toHaveClass("left-0");
    expect(menu).not.toHaveClass("right-0");
    expect(menu).toHaveAttribute("data-placement", "bottom");
  });

  it("flips above the trigger when the navigation bar limits space below", () => {
    nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Navigazione principale");
    document.body.append(nav);
    mockLayout({ trigger: { top: 450, bottom: 480, left: 340, right: 380 } });
    renderActionMenu();

    fireEvent.click(screen.getByRole("button", { name: "Azioni test" }));

    expect(screen.getByRole("menu")).toHaveAttribute("data-placement", "top");
  });

  it("opens without layout measurements and keeps menu items clickable", () => {
    const { onSelect } = renderActionMenu();

    fireEvent.click(screen.getByRole("button", { name: "Azioni test" }));
    const menuItem = screen.getByRole("menuitem", { name: "Modifica" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(menuItem);

    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
