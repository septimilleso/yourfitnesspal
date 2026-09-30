import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useVisualViewportTop } from "./useVisualViewportTop";

function installVisualViewport(offsetTop: number) {
  const viewport = Object.assign(new EventTarget(), { offsetTop, height: 600 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  return viewport;
}

afterEach(() => {
  delete (window as unknown as { visualViewport?: VisualViewport }).visualViewport;
  vi.restoreAllMocks();
});

describe("useVisualViewportTop", () => {
  it("returns 0 without the visualViewport API", () => {
    const { result } = renderHook(() => useVisualViewportTop());

    expect(result.current).toBe(0);
  });

  it("reads the initial offsetTop", () => {
    installVisualViewport(120);

    const { result } = renderHook(() => useVisualViewportTop());

    expect(result.current).toBe(120);
  });

  it("updates when the visual viewport resizes", () => {
    const viewport = installVisualViewport(0);
    const { result } = renderHook(() => useVisualViewportTop());

    act(() => {
      viewport.offsetTop = 240;
      viewport.dispatchEvent(new Event("resize"));
    });

    expect(result.current).toBe(240);
  });

  it("removes the scroll and resize listeners on unmount", () => {
    const viewport = installVisualViewport(0);
    const removeEventListener = vi.spyOn(viewport, "removeEventListener");
    const { unmount } = renderHook(() => useVisualViewportTop());

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
