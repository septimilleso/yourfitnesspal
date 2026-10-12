import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isOffline, reportNetworkFailure, resetConnectivityForTests } from "../native/connectivity";
import { clearPersistedQueryCache } from "../native/queryPersistence";
import { clearToken, getToken, setChallenge, setToken } from "../native/session";
import { ApiError, client, NetworkError } from "./client";

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("../native/platform", () => ({ isNative: () => true }));
vi.mock("../native/queryPersistence", () => ({
  clearPersistedQueryCache: vi.fn().mockResolvedValue(undefined),
}));

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
  resetConnectivityForTests();
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("api client errors on the native platform", () => {
  it("rejects with NetworkError on a network failure and keeps the token", async () => {
    await setToken("tok-a");
    const rejection = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(rejection));

    const error = await client.get("/gym/active").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ name: "NetworkError" });
    expect((error as NetworkError).cause).toBe(rejection);
    expect(isOffline()).toBe(true);
    expect(preferences.remove).not.toHaveBeenCalled();
    expect(getToken()).toBe("tok-a");
  });

  it("rejects with ApiError on a 500, keeps the token and leaves offline mode", async () => {
    await setToken("tok-a");
    reportNetworkFailure();
    expect(isOffline()).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { detail: "boom" })));

    const error = await client.get("/gym/active").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 500, message: "boom" });
    expect(isOffline()).toBe(false);
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

  it("does not clear the session when the token changed while the request was in flight (C10)", async () => {
    await setToken("tok-a");
    let resolveFetch: (value: unknown) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      ),
    );

    const request = client.get("/gym/active").catch((e: unknown) => e);
    await setToken("tok-b");
    resolveFetch(jsonResponse(401, { detail: "unauthorized" }));
    const error = await request;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401 });
    expect(getToken()).toBe("tok-b");
    expect(preferences.remove).not.toHaveBeenCalled();
    expect(clearPersistedQueryCache).not.toHaveBeenCalled();
  });

  it("clears the token and the persisted cache on a session 401 with the current token (C4)", async () => {
    await setToken("tok-a");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { detail: "unauthorized" })));

    const error = await client.get("/gym/active").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(clearPersistedQueryCache).toHaveBeenCalledTimes(1);
    // Il token va rimosso prima della cache: una scrittura in mezzo ricreerebbe il file.
    expect(preferences.remove.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(clearPersistedQueryCache).mock.invocationCallOrder[0],
    );
  });

  it("does not clear the persisted cache on a 401 with another detail", async () => {
    await setToken("tok-a");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { detail: "invalid credentials" })));

    const error = await client.get("/gym/active").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: "invalid credentials" });
    expect(getToken()).toBe("tok-a");
    expect(preferences.remove).not.toHaveBeenCalled();
    expect(clearPersistedQueryCache).not.toHaveBeenCalled();
  });
});
