import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client";
import {
  durationLabel,
  elapsedLabel,
  formatDuration,
  formatKg,
  formatSet,
  lastUsedLabel,
  linkWithNext,
  liveErrorMessage,
  moveItem,
  normalizeSupersets,
  parseDecimal,
  parseDuration,
  parseInteger,
  unlinkFromGroup,
} from "./gym";

describe("number formatting", () => {
  it("formats and parses kg with a decimal comma", () => {
    expect(formatKg(80)).toBe("80");
    expect(formatKg(37.5)).toBe("37,5");
    expect(parseDecimal("37,5")).toBe(37.5);
    expect(parseDecimal(" 80 ")).toBe(80);
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("-1")).toBeNull();
  });

  it("parses integers", () => {
    expect(parseInteger("8")).toBe(8);
    expect(parseInteger("8,5")).toBeNull();
    expect(parseInteger("")).toBeNull();
  });

  it("formats and parses durations", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(5)).toBe("0:05");
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("1:75")).toBeNull();
  });

  it("formats a set like the API does", () => {
    expect(formatSet("weight_reps", { weight_kg: 80, reps: 8, duration_s: null })).toBe("80 kg × 8");
    expect(formatSet("reps", { weight_kg: null, reps: 12, duration_s: null })).toBe("12 rip");
    expect(formatSet("duration", { weight_kg: null, reps: null, duration_s: 75 })).toBe("1:15");
  });
});

describe("time labels", () => {
  it("shows elapsed time", () => {
    const start = "2026-09-24T18:00:00Z";
    expect(elapsedLabel(start, Date.parse("2026-09-24T18:12:34Z"))).toBe("12:34");
    expect(elapsedLabel(start, Date.parse("2026-09-24T19:02:03Z"))).toBe("1:02:03");
  });

  it("shows durations", () => {
    expect(durationLabel("2026-09-24T18:00:00Z", "2026-09-24T18:45:00Z")).toBe("45 min");
    expect(durationLabel("2026-09-24T18:00:00Z", "2026-09-24T19:05:00Z")).toBe("1 h 5 min");
    expect(durationLabel("2026-09-24T18:00:00Z", "2026-09-24T20:00:00Z")).toBe("2 h");
  });

  it("describes when a template was last used", () => {
    const now = new Date(2026, 8, 24, 15, 0);
    expect(lastUsedLabel(null, now)).toBeNull();
    expect(lastUsedLabel(new Date(2026, 8, 24, 8, 0).toISOString(), now)).toBe("Oggi");
    expect(lastUsedLabel(new Date(2026, 8, 23, 22, 0).toISOString(), now)).toBe("Ieri");
    expect(lastUsedLabel(new Date(2026, 8, 18, 10, 0).toISOString(), now)).toBe("6 giorni fa");
    expect(lastUsedLabel(new Date(2025, 10, 21, 10, 0).toISOString(), now)).toContain("2025");
  });
});

describe("supersets", () => {
  it("normalizes groups like the API", () => {
    expect(normalizeSupersets([null, 7, 7, null])).toEqual([null, 1, 1, null]);
    expect(normalizeSupersets([3, null, 5, 5])).toEqual([null, null, 1, 1]);
    expect(normalizeSupersets([2, 2, null, 2, 2])).toEqual([1, 1, null, 2, 2]);
  });

  it("links an exercise with the next one", () => {
    expect(linkWithNext([null, null, null], 0)).toEqual([1, 1, null]);
    expect(linkWithNext([1, 1, null], 1)).toEqual([1, 1, 1]);
    expect(linkWithNext([null, 1, 1], 0)).toEqual([1, 1, 1]);
    expect(linkWithNext([1, 1, 2, 2], 1)).toEqual([1, 1, 1, 1]);
    expect(linkWithNext([null, null], 1)).toEqual([null, null]);
  });

  it("unlinks an exercise", () => {
    expect(unlinkFromGroup([1, 1, 1], 2)).toEqual([1, 1, null]);
    expect(unlinkFromGroup([1, 1], 0)).toEqual([null, null]);
  });

  it("moves items", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("liveErrorMessage", () => {
  it("shows a generic Italian message for invalid API values", () => {
    expect(liveErrorMessage(new ApiError(422, "[object Object]", { detail: [] }))).toBe(
      "Valori non validi",
    );
  });

  it("translates known API errors and network failures", () => {
    expect(liveErrorMessage(new ApiError(400, "weight and reps are required", null))).toBe(
      "Inserisci kg e ripetizioni",
    );
    expect(liveErrorMessage(new ApiError(400, "something else", null))).toBe("something else");
    expect(liveErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Non salvato: controlla la connessione",
    );
  });
});
