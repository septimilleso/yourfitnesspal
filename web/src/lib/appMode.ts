/** The app has two sections sharing one shell: the food diary ("diet") and
 * the gym ("gym"). The mode follows the URL; shared pages (settings,
 * account, admin) keep the last one. Each mode remembers its last page so
 * the header switch returns where the user left off. */

export type AppMode = "diet" | "gym";

const MODE_KEY = "yfp.mode";
const pathKey = (mode: AppMode) => `yfp.lastPath.${mode}`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage: the switch just falls back to defaults.
  }
}

export function modeFromPath(pathname: string): AppMode | null {
  if (pathname === "/gym" || pathname.startsWith("/gym/")) return "gym";
  if (pathname === "/" || pathname.startsWith("/week") || pathname.startsWith("/search")) {
    return "diet";
  }
  return null;
}

export function currentMode(pathname: string): AppMode {
  return modeFromPath(pathname) ?? (read(MODE_KEY) === "gym" ? "gym" : "diet");
}

export function rememberPath(pathname: string, search: string): void {
  const mode = modeFromPath(pathname);
  if (!mode) return;
  write(MODE_KEY, mode);
  const rememberedSearch = pathname.startsWith("/gym/history/") ? "" : search;
  write(pathKey(mode), pathname + rememberedSearch);
}

export function lastPath(mode: AppMode): string {
  return read(pathKey(mode)) ?? (mode === "gym" ? "/gym" : "/");
}
