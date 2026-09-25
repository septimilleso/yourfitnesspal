import { describe, expect, it } from "vitest";

import { badgeProgress } from "./badges";

describe("badgeProgress", () => {
  it.each([
    [0, { earned: 0, nextIn: 5 }],
    [4, { earned: 0, nextIn: 1 }],
    [5, { earned: 1, nextIn: 5 }],
    [7, { earned: 1, nextIn: 3 }],
    [149, { earned: 29, nextIn: 1 }],
    [150, { earned: 30, nextIn: null }],
    [200, { earned: 30, nextIn: null }],
  ])("calculates badge progress for %i days", (current, expected) => {
    expect(badgeProgress(current)).toEqual(expected);
  });
});
