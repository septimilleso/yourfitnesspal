import { Capacitor } from "@capacitor/core";

// true solo dentro l'IPA Capacitor; nel browser e nella PWA è false.
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
