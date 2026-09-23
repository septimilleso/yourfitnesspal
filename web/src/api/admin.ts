import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "./client";
import type { Permission } from "../lib/permissions";
import type { Goal, PutGoalInput } from "./queries";
import type { McpConnection } from "./oauth";

export interface AdminUser {
  id: number; username: string; display_name: string;
  role: "admin" | "user"; permissions: Permission[]; is_active: boolean;
  totp_enabled: boolean; must_change_password: boolean; locked_until: string | null;
  last_login_at: string | null; created_at: string; active_sessions: number;
}
export interface AdminPermission { key: Permission; label: string; default: boolean }
export interface TemporaryPassword { temporary_password: string }
export interface CreateUserInput { username: string; display_name: string; role: "admin" | "user"; permissions?: Permission[] }
export interface UpdateUserInput { id: number; username?: string; display_name?: string; role?: "admin" | "user"; permissions?: Permission[]; is_active?: boolean }
export interface AdminAuditEvent { id: number; action: string; actor_username: string | null; target_username: string | null; created_at: string; details?: Record<string, unknown> }
export interface AdminDeleteInput { id: number; confirm_username: string }

const usersKey = ["admin", "users"] as const;
const invalidateUsers = (queryClient: ReturnType<typeof useQueryClient>) => {
  void queryClient.invalidateQueries({ queryKey: usersKey });
};

export function useAdminUsers() { return useQuery({ queryKey: usersKey, queryFn: () => client.get<AdminUser[]>("/admin/users") }); }
export function useAdminPermissions() { return useQuery({ queryKey: ["admin", "permissions"], queryFn: () => client.get<AdminPermission[]>("/admin/permissions"), staleTime: 5 * 60_000 }); }
export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateUserInput) => client.post<{ user: AdminUser } & TemporaryPassword>("/admin/users", input), onSettled: () => invalidateUsers(qc) });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...input }: UpdateUserInput) => client.patch<AdminUser>(`/admin/users/${id}`, input), onSettled: () => invalidateUsers(qc) });
}
function action<T = void>(path: string, method: "post" | "delete" = "post") {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => method === "delete" ? client.delete<T>(path) : client.post<T>(path), onSettled: () => invalidateUsers(qc) });
}
export function useResetPassword(id?: number) { return action<TemporaryPassword>(`/admin/users/${id ?? 0}/reset-password`); }
export function useResetTotp(id?: number) { return action(`/admin/users/${id ?? 0}/reset-totp`); }
export function useUnlockUser(id?: number) { return action(`/admin/users/${id ?? 0}/unlock`); }
export function useRevokeSessions(id?: number) { return action(`/admin/users/${id ?? 0}/sessions`, "delete"); }
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, confirm_username }: AdminDeleteInput) => client.delete<void>(`/admin/users/${id}`, { body: { confirm_username } }), onSettled: () => invalidateUsers(qc) });
}
export function useAdminUserGoal(id: number | undefined) { return useQuery({ queryKey: ["admin", "users", id, "goal"], queryFn: () => client.get<Goal>(`/admin/users/${id}/goal`), enabled: id !== undefined }); }
export function usePutAdminUserGoal(id: number) { const qc = useQueryClient(); return useMutation({ mutationFn: (input: PutGoalInput) => client.put<Goal>(`/admin/users/${id}/goal`, input), onSettled: () => invalidateUsers(qc) }); }
export function useAuditLog() { return useQuery({ queryKey: ["admin", "audit"], queryFn: () => client.get<AdminAuditEvent[]>("/admin/audit?limit=200") }); }
export function useAdminMcpConnections(id: number) { return useQuery({ queryKey: ["admin", "users", id, "mcp"], queryFn: () => client.get<McpConnection[]>(`/admin/users/${id}/mcp-connections`) }); }
export function useRevokeAdminMcpConnections(id: number) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => client.delete<void>(`/admin/users/${id}/mcp-connections`), onSettled: () => void qc.invalidateQueries({ queryKey: ["admin", "users", id, "mcp"] }) });
}
