// Pin the test environment to a non-UTC, positive-offset timezone so this
// test actually exercises the bug CRITICAL 2 (final review) fixed: date
// helpers that mixed local-time construction with UTC-time reading (or vice
// versa) silently broke outside UTC, specifically in Europe/Rome, this
// app's deploy timezone.
//
// `@types/node` isn't a project dependency, so `process` is declared
// ambiently here rather than pulling in the full Node type package just for
// this one env var.
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = "Europe/Rome";

import { describe, expect, it } from "vitest";

import { shiftIsoDate, todayIso } from "./date";

describe("shiftIsoDate", () => {
  it("moves exactly one calendar day forward across the boundary that previously broke", () => {
    // Reviewer's own repro: next day from 2026-08-26 should be 2026-08-27,
    // not 2026-08-26 (the old local-parse/UTC-read helper could return the
    // same day it started from in Europe/Rome).
    expect(shiftIsoDate("2026-08-26", 1)).toBe("2026-08-27");
  });

  it("moves exactly one calendar day backward across the boundary that previously broke", () => {
    // Reviewer's own repro: prev day from 2026-08-26 should be 2026-08-25,
    // not 2026-08-24.
    expect(shiftIsoDate("2026-08-26", -1)).toBe("2026-08-25");
  });

  it("shifts +7 days to exactly one week later with no drift", () => {
    expect(shiftIsoDate("2026-08-26", 7)).toBe("2026-09-02");
  });

  it("shifts +7 days across a month boundary with no drift", () => {
    expect(shiftIsoDate("2026-08-28", 7)).toBe("2026-09-04");
  });

  it("shifts -7 days to exactly one week earlier with no drift", () => {
    expect(shiftIsoDate("2026-09-02", -7)).toBe("2026-08-26");
  });

  it("handles a year boundary correctly", () => {
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("todayIso", () => {
  it("returns an ISO-formatted (YYYY-MM-DD) date string", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
