import { describe, expect, it } from "vitest";

import { clockOffsetMs, remainingSeconds } from "./restTimer";

describe("rest timer math", () => {
  it("computes the server clock offset", () => {
    expect(clockOffsetMs("2026-09-24T18:00:10Z", Date.parse("2026-09-24T18:00:00Z"))).toBe(10_000);
  });

  it("counts down using the server clock", () => {
    const ends = "2026-09-24T18:01:30Z";
    const client = Date.parse("2026-09-24T18:00:00Z");
    expect(remainingSeconds(ends, 0, client)).toBe(90);
    // the phone is 10 s behind the server: 10 s less to wait
    expect(remainingSeconds(ends, 10_000, client)).toBe(80);
    expect(remainingSeconds(ends, 0, client + 89_500)).toBe(1);
    expect(remainingSeconds(ends, 0, client + 95_000)).toBe(0);
    expect(remainingSeconds(null, 0, client)).toBe(0);
  });
});
