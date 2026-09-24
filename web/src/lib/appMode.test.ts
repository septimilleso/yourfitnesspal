import { beforeEach, describe, expect, it } from "vitest";

import { currentMode, lastPath, modeFromPath, rememberPath } from "./appMode";

describe("appMode", () => {
  beforeEach(() => window.localStorage.clear());

  it("derives the mode from the path", () => {
    expect(modeFromPath("/")).toBe("diet");
    expect(modeFromPath("/week")).toBe("diet");
    expect(modeFromPath("/search")).toBe("diet");
    expect(modeFromPath("/gym")).toBe("gym");
    expect(modeFromPath("/gym/history/3")).toBe("gym");
    expect(modeFromPath("/settings")).toBeNull();
  });

  it("remembers the last page of each mode", () => {
    expect(lastPath("gym")).toBe("/gym");
    expect(lastPath("diet")).toBe("/");
    rememberPath("/gym/exercises", "");
    rememberPath("/week", "?start=2026-09-21");
    expect(lastPath("gym")).toBe("/gym/exercises");
    expect(lastPath("diet")).toBe("/week?start=2026-09-21");
  });

  it("keeps the last mode on shared pages", () => {
    rememberPath("/gym", "");
    expect(currentMode("/settings")).toBe("gym");
    rememberPath("/", "");
    expect(currentMode("/settings")).toBe("diet");
  });
});
