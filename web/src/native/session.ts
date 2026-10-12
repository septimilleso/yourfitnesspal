import { Preferences } from "@capacitor/preferences";

import { isNative } from "./platform";

// Il token non va mai scritto in log né messo in URL. Sul web tutte le funzioni sono no-op.
const SESSION_KEY = "yfp.session";

let token: string | null = null;
let challenge: string | null = null;

export async function loadNativeSession(): Promise<void> {
  if (!isNative()) return;
  const { value } = await Preferences.get({ key: SESSION_KEY });
  token = value;
}

export function getToken(): string | null {
  return isNative() ? token : null;
}

export async function setToken(value: string): Promise<void> {
  if (!isNative()) return;
  token = value;
  await Preferences.set({ key: SESSION_KEY, value });
}

export async function clearToken(): Promise<void> {
  if (!isNative()) return;
  token = null;
  await Preferences.remove({ key: SESSION_KEY });
}

// Il challenge di login resta in memoria: serve solo tra la password e il TOTP.
export function getChallenge(): string | null {
  return isNative() ? challenge : null;
}

export function setChallenge(value: string | null): void {
  if (!isNative()) return;
  challenge = value;
}
