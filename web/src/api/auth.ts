import { client } from "./client";
import type { Permission } from "../lib/permissions";

export interface LoginResponse { status: "totp_required" | "setup_required" | string; must_change_password?: boolean; }
export interface Me { id: number; username: string; display_name: string; role: "admin" | "user"; permissions: Permission[]; mcp_url: string; }
export interface SetupStartResponse { otpauth_uri: string; secret: string; qr_svg_data_uri: string; }
export interface RecoveryCodesResponse { recovery_codes: string[]; }
export interface Session { id: number; created_at: string; last_seen_at: string; user_agent: string | null; ip: string | null; current: boolean; }

export const login = (username: string, password: string) => client.post<LoginResponse>("/auth/login", { username, password });
export const verifyTotp = (body: { code: string } | { recovery_code: string }) => client.post<{ status: string }>("/auth/totp", body);
export const setupStart = () => client.post<SetupStartResponse>("/auth/setup/start");
export const setupComplete = (body: { code: string; new_password?: string }) => client.post<RecoveryCodesResponse & { status: string }>("/auth/setup/complete", body);
export const logout = () => client.post<void>("/auth/logout");
export const getMe = () => client.get<Me>("/auth/me");
export const changePassword = (body: { current_password: string; new_password: string }) => client.post<void>("/auth/password", body);
export const regenerateRecoveryCodes = (code: string) => client.post<RecoveryCodesResponse>("/auth/recovery-codes", { code });
export const listSessions = () => client.get<Session[]>("/auth/sessions");
export const revokeSession = (id: number) => client.delete<void>(`/auth/sessions/${id}`);
