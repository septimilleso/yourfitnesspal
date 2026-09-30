import { client } from "./client";

export interface PushConfig {
  public_key: string | null;
}

export function getPushConfig(): Promise<PushConfig> {
  return client.get<PushConfig>("/push/config");
}

export function subscribePush(sub: PushSubscriptionJSON): Promise<void> {
  return client.post<void>("/push/subscriptions", {
    endpoint: sub.endpoint,
    keys: sub.keys,
  });
}

export function unsubscribePush(endpoint: string): Promise<void> {
  return client.post<void>("/push/unsubscribe", { endpoint });
}
