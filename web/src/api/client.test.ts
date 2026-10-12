import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, client } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("api client", () => {
  it("prefixes the path with /api and sends cookies with the YFP header on GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(client.get<{ ok: boolean }>("/health")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/health", {
      credentials: "include",
      headers: { "X-Requested-With": "yfp" },
      method: "GET",
    });
  });

  it("sends Content-Type and a JSON-serialized body only when a body is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await client.post("/items", { name: "uova", qty: 2 });

    expect(fetchMock).toHaveBeenCalledWith("/api/items", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"name":"uova","qty":2}',
    });
  });

  it("does not send Authorization or Content-Type on web requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);

    await client.post("/auth/logout");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers).toEqual({ "X-Requested-With": "yfp" });
    expect(headers).not.toHaveProperty("Authorization");
    expect(init).not.toHaveProperty("body");
  });

  it("throws ApiError with status and the detail of the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { detail: "credenziali non valide" })),
    );

    const error = await client.post("/auth/login", { username: "a", password: "b" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: "ApiError",
      status: 401,
      message: "credenziali non valide",
      body: { detail: "credenziali non valide" },
    });
  });

  it("falls back to a status message when the error response has no JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));

    const error = await client.get("/gym/active").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 502,
      message: "Request failed with status 502",
      body: null,
    });
  });

  it("returns undefined on 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));

    await expect(client.delete("/auth/sessions/3")).resolves.toBeUndefined();
  });
});
