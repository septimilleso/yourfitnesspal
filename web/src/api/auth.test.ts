import { afterEach, describe, expect, it, vi } from "vitest";

import { login, logout, setupComplete, setupStart, verifyTotp } from "./auth";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("auth api", () => {
  it("login posts username and password and returns the server status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: "totp_required", must_change_password: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(login("alice", "s3cret")).resolves.toEqual({
      status: "totp_required",
      must_change_password: false,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"username":"alice","password":"s3cret"}',
    });
  });

  it("verifyTotp posts the TOTP code to /auth/totp", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyTotp({ code: "123456" })).resolves.toEqual({ status: "ok" });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/totp", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"code":"123456"}',
    });
  });

  it("verifyTotp posts a recovery code as recovery_code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await verifyTotp({ recovery_code: "abcd-1234" });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/totp", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"recovery_code":"abcd-1234"}',
    });
  });

  it("setupStart posts without a body and returns the TOTP setup data", async () => {
    const setup = {
      otpauth_uri: "otpauth://totp/yfp:alice?secret=ABC",
      secret: "ABC",
      qr_svg_data_uri: "data:image/svg+xml;base64,PHN2Zy8+",
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, setup));
    vi.stubGlobal("fetch", fetchMock);

    await expect(setupStart()).resolves.toEqual(setup);

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/setup/start", {
      credentials: "include",
      headers: { "X-Requested-With": "yfp" },
      method: "POST",
    });
  });

  it("setupComplete posts code and new password and returns the recovery codes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: "ok", recovery_codes: ["aaaa-1111", "bbbb-2222"] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(setupComplete({ code: "654321", new_password: "Nuova-pass-1" })).resolves.toEqual({
      status: "ok",
      recovery_codes: ["aaaa-1111", "bbbb-2222"],
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/setup/complete", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"code":"654321","new_password":"Nuova-pass-1"}',
    });
  });

  it("setupComplete omits new_password when it is not given", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { status: "ok", recovery_codes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await setupComplete({ code: "654321" });

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/setup/complete", {
      credentials: "include",
      headers: {
        "X-Requested-With": "yfp",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: '{"code":"654321"}',
    });
  });

  it("logout posts to /auth/logout and resolves on the server 204", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(logout()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      credentials: "include",
      headers: { "X-Requested-With": "yfp" },
      method: "POST",
    });
  });
});
