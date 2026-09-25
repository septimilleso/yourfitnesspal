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

import {
  formatIsoDateLong,
  formatIsoDateShort,
  relativeDayLabel,
  shiftIsoDate,
  startOfWeek,
  todayIso,
} from "./date";

describe("startOfWeek", () => {
  it("returns the Monday of the ISO week", () => {
    expect(startOfWeek("2026-09-25")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
  });
});

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

describe("formatIsoDateLong", () => {
  // Same Europe/Rome pinning as above: an ISO calendar date must render as
  // the day it names, never the day before, so the formatter has to read it
  // as UTC just like `shiftIsoDate` writes it.
  it("renders the weekday and day named by the ISO date, not the one before it", () => {
    // 2026-08-26 is a Wednesday.
    expect(formatIsoDateLong("2026-08-26")).toMatch(/mercoled/i);
    expect(formatIsoDateLong("2026-08-26")).toContain("26");
    expect(formatIsoDateLong("2026-08-26")).toMatch(/agosto/i);
  });

  it("includes the year only for dates outside the current year", () => {
    const thisYear = todayIso().slice(0, 4);
    expect(formatIsoDateLong(`${thisYear}-03-04`)).not.toContain(thisYear);
    expect(formatIsoDateLong("1999-03-04")).toContain("1999");
  });
});

describe("formatIsoDateShort", () => {
  it("renders a compact day + month for the date named", () => {
    const formatted = formatIsoDateShort("2026-08-26");
    expect(formatted).toContain("26");
    expect(formatted).toMatch(/ago/i);
  });
});

describe("relativeDayLabel", () => {
  it("labels today, yesterday and tomorrow", () => {
    const today = todayIso();
    expect(relativeDayLabel(today)).toBe("Oggi");
    expect(relativeDayLabel(shiftIsoDate(today, -1))).toBe("Ieri");
    expect(relativeDayLabel(shiftIsoDate(today, 1))).toBe("Domani");
  });

  it("returns null for any date further away", () => {
    expect(relativeDayLabel(shiftIsoDate(todayIso(), 2))).toBeNull();
    expect(relativeDayLabel(shiftIsoDate(todayIso(), -30))).toBeNull();
  });
});
