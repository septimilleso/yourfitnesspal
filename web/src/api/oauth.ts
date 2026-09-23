import { client } from "./client";

export interface ConsentInfo {
  client_name: string;
  redirect_host: string | null;
  user: { username: string; display_name: string };
  has_permission: boolean;
}

export interface McpConnection {
  client_id: string;
  client_name: string;
  connected_at: string;
  last_used_at: string | null;
}

export const getConsent = (req: string) =>
  client.get<ConsentInfo>(`/oauth/consent?req=${encodeURIComponent(req)}`);
export const decideConsent = (req: string, approve: boolean) =>
  client.post<{ redirect_url: string }>("/oauth/consent", { req, approve });
export const listConnections = () => client.get<McpConnection[]>("/oauth/connections");
export const revokeConnection = (clientId: string) =>
  client.delete<void>(`/oauth/connections/${encodeURIComponent(clientId)}`);
