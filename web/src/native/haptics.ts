import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

import { isNative } from "./platform";

// Il feedback è un extra: un errore del plugin non deve mai toccare la UI.
async function runNativeHaptic(call: () => Promise<void>): Promise<void> {
  if (!isNative()) return;
  try {
    await call();
  } catch {
    // Senza haptics l'app funziona lo stesso.
  }
}

/** Colpo leggero quando una serie viene completata. Sul web non fa nulla. */
export function hapticSetComplete(): void {
  void runNativeHaptic(() => Haptics.impact({ style: ImpactStyle.Light }));
}

/** Notifica di successo a fine riposo. Sul web non fa nulla. */
export function hapticRestEnd(): void {
  void runNativeHaptic(() => Haptics.notification({ type: NotificationType.Success }));
}
