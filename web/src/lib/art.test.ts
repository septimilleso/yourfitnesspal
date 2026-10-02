import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { artIcon, weightScene } from "./art";

describe("weight artwork paths", () => {
  it("uses separate icon and scene assets for each section", () => {
    expect(artIcon("diet", "weight")).toBe("/art/diet/icons/weight.png");
    expect(artIcon("gym", "weight")).toBe("/art/gym/icons/weight.png");
    expect(weightScene("diet")).toBe("/art/diet/weight.webp");
    expect(weightScene("gym")).toBe("/art/gym/weight.webp");
    expect(weightScene("diet")).not.toBe(weightScene("gym"));
  });

  it("has all four assets in the public directory", () => {
    for (const path of [
      "art/diet/icons/weight.png",
      "art/gym/icons/weight.png",
      "art/diet/weight.webp",
      "art/gym/weight.webp",
    ]) {
      expect(existsSync(resolve(process.cwd(), "public", path))).toBe(true);
    }
  });
});
