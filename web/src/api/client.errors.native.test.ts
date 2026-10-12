import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToken, getToken, setChallenge, setToken } from "../native/session";
import { ApiError, client } from "./client";

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("../native/platform", () => ({ isNative: () => true }));

beforeEach(async () => {
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  await clearToken();
  setChallenge(null);
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("api client errors on the native platform", () => {
  it("rejects on a network failure and keeps the token", async () => {
    await setToken("tok-a");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(client.get("/gym/active")).rejects.toThrow("Failed to fetch");

    expect(preferences.remove).not.toHaveBeenCalled();
    expect(getToken()).toBe("tok-a");
  });

  it("rejects with ApiError on a 500 and keeps the token", async () => {
    await setToken("tok-a");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { detail: "boom" })));

    const error = await client.get("/gym/active").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, message: "boom" });
    expect(preferences.remove).not.toHaveBeenCalled();
    expect(getToken()).toBe("tok-a");
  });

  it("rejects with ApiError on a 502 without JSON and keeps the token", async () => {
    await setToken("tok-a");
    const badGateway = {
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(badGateway));

    const error = await client.get("/gym/active").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, message: "Request failed with status 502" });
    expect(preferences.remove).not.toHaveBeenCalled();
    expect(getToken()).toBe("tok-a");
  });
});
