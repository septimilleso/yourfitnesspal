import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hapticRestEnd, hapticSetComplete } from "./haptics";

const haptics = vi.hoisted(() => ({ impact: vi.fn(), notification: vi.fn() }));
const platform = vi.hoisted(() => ({ native: true }));

vi.mock("@capacitor/haptics", () => ({
  Haptics: haptics,
  ImpactStyle: { Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS" },
}));
vi.mock("./platform", () => ({ isNative: () => platform.native }));

beforeEach(() => {
  vi.clearAllMocks();
  haptics.impact.mockResolvedValue(undefined);
  haptics.notification.mockResolvedValue(undefined);
  platform.native = true;
});

afterEach(() => {
  platform.native = true;
});

describe("haptics on the native platform", () => {
  it("fires a light impact when a set is completed", () => {
    hapticSetComplete();
    expect(haptics.impact).toHaveBeenCalledTimes(1);
    expect(haptics.impact).toHaveBeenCalledWith({ style: "LIGHT" });
    expect(haptics.notification).not.toHaveBeenCalled();
  });

  it("fires a success notification at rest end", () => {
    hapticRestEnd();
    expect(haptics.notification).toHaveBeenCalledTimes(1);
    expect(haptics.notification).toHaveBeenCalledWith({ type: "SUCCESS" });
    expect(haptics.impact).not.toHaveBeenCalled();
  });

  it("ignores plugin rejections without unhandled errors", async () => {
    haptics.impact.mockRejectedValue(new Error("haptics unavailable"));
    haptics.notification.mockRejectedValue(new Error("haptics unavailable"));

    expect(() => hapticSetComplete()).not.toThrow();
    expect(() => hapticRestEnd()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(haptics.impact).toHaveBeenCalledTimes(1);
    expect(haptics.notification).toHaveBeenCalledTimes(1);
  });

  it("ignores synchronous plugin errors", () => {
    haptics.impact.mockImplementation(() => {
      throw new Error("haptics unavailable");
    });
    expect(() => hapticSetComplete()).not.toThrow();
  });
});

describe("haptics on the web", () => {
  beforeEach(() => {
    platform.native = false;
  });

  it("does not call the plugin for a completed set", () => {
    hapticSetComplete();
    expect(haptics.impact).not.toHaveBeenCalled();
    expect(haptics.notification).not.toHaveBeenCalled();
  });

  it("does not call the plugin at rest end", () => {
    hapticRestEnd();
    expect(haptics.impact).not.toHaveBeenCalled();
    expect(haptics.notification).not.toHaveBeenCalled();
  });
});
