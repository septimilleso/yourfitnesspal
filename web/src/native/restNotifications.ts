import { Directory, Filesystem } from "@capacitor/filesystem";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";

import type { Workout } from "../api/gym";
import { clockOffsetMs } from "../lib/restTimer";
import { isNative } from "./platform";

// Una sola notifica di riposo pendente: id fisso, sostituita a ogni nuovo rest_ends_at.
const REST_NOTIFICATION_ID = 4101;
const ALERTS_KEY = "yfp.restAlerts";
const SOUND_FILE = "rest-bell.wav";
const REST_URL = "/gym/workout";

export async function getRestAlertsEnabled(): Promise<boolean> {
  if (!isNative()) return false;
  const { value } = await Preferences.get({ key: ALERTS_KEY });
  return value === "true";
}

export async function setRestAlertsEnabled(enabled: boolean): Promise<void> {
  if (!isNative()) return;
  await Preferences.set({ key: ALERTS_KEY, value: enabled ? "true" : "false" });
}

async function cancelPending(): Promise<void> {
  await LocalNotifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
}

async function applyRestNotification(workout: Workout | null): Promise<void> {
  const restEndsAt = workout?.rest_ends_at ? Date.parse(workout.rest_ends_at) : NaN;
  // Il riposo è sul clock del server: lo riportiamo al clock del telefono con lo stesso offset di RestTimerBar.
  const fireAt = workout ? restEndsAt - clockOffsetMs(workout.server_now, Date.now()) : NaN;

  if (!workout || !Number.isFinite(fireAt) || fireAt <= Date.now()) {
    await cancelPending();
    return;
  }
  if (!(await getRestAlertsEnabled())) {
    await cancelPending();
    return;
  }
  const { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted") {
    await cancelPending();
    return;
  }

  await cancelPending();
  await LocalNotifications.schedule({
    notifications: [
      {
        id: REST_NOTIFICATION_ID,
        title: workout.name.trim() ? `Riposo finito · ${workout.name}` : "Riposo finito",
        body: "",
        schedule: { at: new Date(fireAt) },
        sound: SOUND_FILE,
        extra: { url: REST_URL },
      },
    ],
  });
}

// Le chiamate si susseguono in ordine: due sync sovrapposte non devono lasciare una notifica orfana.
let queue: Promise<void> = Promise.resolve();

export function syncRestNotification(workout: Workout | null): Promise<void> {
  if (!isNative()) return Promise.resolve();
  const next = queue.then(() => applyRestNotification(workout));
  queue = next.catch(() => undefined);
  return next;
}

export function cancelRestNotification(): Promise<void> {
  if (!isNative()) return Promise.resolve();
  const next = queue.then(cancelPending);
  queue = next.catch(() => undefined);
  return next;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** Copia la campanella in Library/Sounds, dove iOS la cerca come suono di notifica. Best-effort: senza file iOS usa il suono di sistema. */
export async function installNotificationSound(): Promise<void> {
  if (!isNative()) return;
  try {
    const response = await fetch(`/sounds/${SOUND_FILE}`);
    if (!response.ok) return;
    await Filesystem.writeFile({
      path: `Sounds/${SOUND_FILE}`,
      data: toBase64(await response.arrayBuffer()),
      directory: Directory.Library,
      recursive: true,
    });
  } catch {
    // Il suono è un ripiego: senza file la notifica resta con il suono di sistema.
  }
}
