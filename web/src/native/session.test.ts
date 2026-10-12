import { beforeEach, describe, expect, it, vi } from "vitest";

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
const platform = vi.hoisted(() => ({ native: true }));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("./platform", () => ({ isNative: () => platform.native }));

async function loadSession() {
  vi.resetModules();
  return import("./session");
}

beforeEach(() => {
  vi.clearAllMocks();
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  platform.native = true;
});

describe("native session (native platform)", () => {
  it("loads the token from Preferences under yfp.session", async () => {
    preferences.get.mockResolvedValue({ value: "tok-1" });
    const session = await loadSession();

    await session.loadNativeSession();

    expect(preferences.get).toHaveBeenCalledWith({ key: "yfp.session" });
    expect(session.getToken()).toBe("tok-1");
  });

  it("keeps the token null when nothing is stored", async () => {
    const session = await loadSession();

    await session.loadNativeSession();

    expect(session.getToken()).toBeNull();
  });

  it("setToken writes the token to Preferences and to memory", async () => {
    const session = await loadSession();

    await session.setToken("tok-2");

    expect(preferences.set).toHaveBeenCalledWith({ key: "yfp.session", value: "tok-2" });
    expect(session.getToken()).toBe("tok-2");
  });

  it("clearToken removes the key and empties memory", async () => {
    preferences.get.mockResolvedValue({ value: "tok-3" });
    const session = await loadSession();
    await session.loadNativeSession();

    await session.clearToken();

    expect(preferences.remove).toHaveBeenCalledWith({ key: "yfp.session" });
    expect(session.getToken()).toBeNull();
  });

  it("keeps the challenge in memory only", async () => {
    const session = await loadSession();

    session.setChallenge("challenge-1");

    expect(session.getChallenge()).toBe("challenge-1");
    expect(preferences.set).not.toHaveBeenCalled();
  });
});

describe("native session (web platform)", () => {
  beforeEach(() => {
    platform.native = false;
  });

  it("is a no-op: nothing is read, written or removed", async () => {
    const session = await loadSession();

    await session.loadNativeSession();
    await session.setToken("tok-web");
    await session.clearToken();
    session.setChallenge("challenge-web");

    expect(preferences.get).not.toHaveBeenCalled();
    expect(preferences.set).not.toHaveBeenCalled();
    expect(preferences.remove).not.toHaveBeenCalled();
    expect(session.getToken()).toBeNull();
    expect(session.getChallenge()).toBeNull();
  });
});
