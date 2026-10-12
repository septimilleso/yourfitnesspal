import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearToken, getChallenge, getToken, setChallenge } from "../native/session";
import { login, setupComplete, verifyTotp } from "./auth";

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
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("auth api on the native platform", () => {
  it("login keeps the challenge returned by the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { status: "totp_required", challenge: "ch-login" })),
    );

    await login("alice", "s3cret");

    expect(getChallenge()).toBe("ch-login");
  });

  it("login without a challenge in the body leaves the challenge unset", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { status: "totp_required" })));

    await login("alice", "s3cret");

    expect(getChallenge()).toBeNull();
  });

  it("sends the challenge saved by login on the TOTP call", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { status: "totp_required", challenge: "ch-login" }))
      .mockResolvedValueOnce(jsonResponse(200, { status: "ok", token: "tok-totp" }));
    vi.stubGlobal("fetch", fetchMock);

    await login("alice", "s3cret");
    await verifyTotp({ code: "123456" });

    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers).toMatchObject({ "X-YFP-Client": "native", "X-YFP-Challenge": "ch-login" });
  });

  it("verifyTotp saves the token and clears the challenge", async () => {
    setChallenge("ch-1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok", token: "tok-totp" })));

    await expect(verifyTotp({ code: "123456" })).resolves.toEqual({ status: "ok", token: "tok-totp" });

    expect(preferences.set).toHaveBeenCalledWith({ key: "yfp.session", value: "tok-totp" });
    expect(getToken()).toBe("tok-totp");
    expect(getChallenge()).toBeNull();
  });

  it("verifyTotp with a recovery code saves the token too", async () => {
    setChallenge("ch-recovery");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok", token: "tok-rec" })));

    await verifyTotp({ recovery_code: "abcd-1234" });

    expect(getToken()).toBe("tok-rec");
    expect(getChallenge()).toBeNull();
  });

  it("setupComplete saves the token and clears the challenge", async () => {
    setChallenge("ch-setup");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok", recovery_codes: ["aaaa-1111"], token: "tok-setup" })),
    );

    await setupComplete({ code: "654321", new_password: "Nuova-pass-1" });

    expect(preferences.set).toHaveBeenCalledWith({ key: "yfp.session", value: "tok-setup" });
    expect(getToken()).toBe("tok-setup");
    expect(getChallenge()).toBeNull();
  });

  it("does not write the session when the response has no token", async () => {
    setChallenge("ch-1");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok" })));

    await verifyTotp({ code: "123456" });

    expect(preferences.set).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });
});
