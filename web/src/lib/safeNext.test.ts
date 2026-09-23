import { describe, expect, it } from "vitest";

import { safeNext } from "./safeNext";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/connect?req=abc")).toBe("/connect?req=abc");
  });

  it.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example", "connect"])(
    "rejects %s",
    (value) => {
      expect(safeNext(value)).toBeNull();
    },
  );
});
