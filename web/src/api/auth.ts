import { client } from "./client";
import type { Permission } from "../lib/permissions";
import { setChallenge, setToken } from "../native/session";

// Nel client nativo il server risponde con challenge (login) e token (ultimo passaggio). Sul web sono assenti.
export interface LoginResponse { status: "totp_required" | "setup_required" | string; must_change_password?: boolean; challenge?: string; }
export interface Me { id: number; username: string; display_name: string; role: "admin" | "user"; permissions: Permission[]; mcp_url: string; }
export interface SetupStartResponse { otpauth_uri: string; secret: string; qr_svg_data_uri: string; }
export interface RecoveryCodesResponse { recovery_codes: string[]; }
export interface Session { id: number; created_at: string; last_seen_at: string; user_agent: string | null; ip: string | null; current: boolean; }

// Il token non va mai scritto in log né messo in URL.
async function keepNativeSession(token: string | undefined) {
  setChallenge(null);
  if (token) await setToken(token);
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const result = await client.post<LoginResponse>("/auth/login", { username, password });
  if (result.challenge) setChallenge(result.challenge);
  return result;
}

export async function verifyTotp(body: { code: string } | { recovery_code: string }): Promise<{ status: string; token?: string }> {
  const result = await client.post<{ status: string; token?: string }>("/auth/totp", body);
  await keepNativeSession(result.token);
  return result;
}

export const setupStart = () => client.post<SetupStartResponse>("/auth/setup/start");

export async function setupComplete(body: { code: string; new_password?: string }): Promise<RecoveryCodesResponse & { status: string; token?: string }> {
  const result = await client.post<RecoveryCodesResponse & { status: string; token?: string }>("/auth/setup/complete", body);
  await keepNativeSession(result.token);
  return result;
}
export const logout = () => client.post<void>("/auth/logout");
export const getMe = () => client.get<Me>("/auth/me");
export const changePassword = (body: { current_password: string; new_password: string }) => client.post<void>("/auth/password", body);
export const regenerateRecoveryCodes = (code: string) => client.post<RecoveryCodesResponse>("/auth/recovery-codes", { code });
export const listSessions = () => client.get<Session[]>("/auth/sessions");
export const revokeSession = (id: number) => client.delete<void>(`/auth/sessions/${id}`);
