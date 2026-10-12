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

describe("api client on the native platform", () => {
  it("calls the absolute base URL from VITE_API_BASE_URL", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://pal.septimilleso.uk/api");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await client.get("/health");

    expect(fetchMock).toHaveBeenCalledWith("https://pal.septimilleso.uk/api/health", {
      credentials: "omit",
      headers: { "X-Requested-With": "yfp", "X-YFP-Client": "native" },
      method: "GET",
    });
  });

  it("sends the Bearer token and omits cookies", async () => {
    await setToken("tok-abc");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchMock);

    await client.get("/gym/active");

    expect(fetchMock).toHaveBeenCalledWith("/api/gym/active", {
      credentials: "omit",
      headers: {
        "X-Requested-With": "yfp",
        "X-YFP-Client": "native",
        Authorization: "Bearer tok-abc",
      },
      method: "GET",
    });
  });

  it("sends Content-Type and Bearer together on a POST with a body", async () => {
    await setToken("tok-post");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await client.post("/items", { qty: 2 });

    expect(fetchMock).toHaveBeenCalledWith("/api/items", {
      credentials: "omit",
      headers: {
        "X-Requested-With": "yfp",
        "X-YFP-Client": "native",
        Authorization: "Bearer tok-post",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"qty":2}',
    });
  });

  it("sends no Authorization header when there is no token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await client.get("/gym/active");

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers).not.toHaveProperty("Authorization");
  });

  it("sends the challenge header only on /auth/* calls", async () => {
    setChallenge("challenge-1");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await client.post("/auth/totp", { code: "123456" });
    await client.get("/gym/active");

    const authHeaders = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const gymHeaders = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(authHeaders).toMatchObject({ "X-YFP-Challenge": "challenge-1" });
    expect(gymHeaders).not.toHaveProperty("X-YFP-Challenge");
  });

  it("removes the token on a 401 with detail unauthorized", async () => {
    await setToken("tok-expired");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { detail: "unauthorized" })),
    );

    const error = await client.get("/gym/active").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: "unauthorized" });
    expect(preferences.remove).toHaveBeenCalledWith({ key: "yfp.session" });
    expect(getToken()).toBeNull();
  });

  it("keeps the token on a 401 with a wrong-credentials detail", async () => {
    await setToken("tok-keep");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: "credenziali non valide" }))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await client.post("/auth/login", { username: "a", password: "b" }).catch(() => undefined);
    await client.get("/gym/active");

    expect(preferences.remove).not.toHaveBeenCalled();
    expect(getToken()).toBe("tok-keep");
    const headers = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers).toMatchObject({ Authorization: "Bearer tok-keep" });
  });
});
