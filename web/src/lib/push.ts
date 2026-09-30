import { subscribePush, unsubscribePush } from "../api/push";

export type PushAvailability = "unsupported" | "denied" | "available";

const LOGOUT_TIMEOUT_MS = 3000;

export function pushAvailability(): PushAvailability {
  if (
    typeof navigator === "undefined" ||
    !navigator.serviceWorker ||
    typeof window === "undefined" ||
    typeof window.PushManager === "undefined" ||
    typeof window.Notification === "undefined"
  ) {
    return "unsupported";
  }

  if (window.Notification.permission === "denied") return "denied";
  return "available";
}

export function urlBase64ToUint8Array(key: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function isDeviceSubscribed(): Promise<boolean> {
  if (typeof window === "undefined" || window.Notification?.permission !== "granted") return false;
  return (await currentSubscription()) !== null;
}

export async function enableRestAlerts(publicKey: string): Promise<"enabled" | "denied"> {
  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const registration = await navigator.serviceWorker.ready;
  const applicationServerKey = urlBase64ToUint8Array(publicKey);
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    }));

  try {
    await subscribePush(subscription.toJSON());
  } catch (error) {
    try {
      await subscription.unsubscribe();
    } catch {
      // Keep the server registration error as the cause of failure.
    }
    throw error;
  }

  return "enabled";
}

export async function disableRestAlerts(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;

  await unsubscribePush(subscription.endpoint);
  await subscription.unsubscribe();
}

export async function unsubscribeDeviceOnLogout(): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const subscription = await currentSubscription();
        if (!subscription) return;

        const serverRemoval = Promise.resolve()
          .then(() => unsubscribePush(subscription.endpoint))
          .catch(() => undefined);
        const localRemoval = Promise.resolve()
          .then(() => subscription.unsubscribe())
          .catch(() => undefined);
        await Promise.all([serverRemoval, localRemoval]);
      })(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, LOGOUT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Logout must continue if the browser or push service is unavailable.
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
