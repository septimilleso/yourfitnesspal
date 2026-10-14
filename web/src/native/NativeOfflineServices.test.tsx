import { Haptics } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../auth/AuthContext";
import { gymKeys } from "../api/gym";
import { createQueryClient } from "../lib/queryClient";
import { meWith, type Reply, type RouteContext, routeFetch } from "../test/prefetchFixtures";
import { resetConnectivityForTests, startConnectivityRecovery } from "./connectivity";
import NativeBridge from "./NativeBridge";
import NativeOfflineServices from "./NativeOfflineServices";
import { startGymSync } from "./gymSync";
import { resetPrefetchSchedulerForTests, startPrefetch } from "./prefetchScheduler";
import { clearToken, getToken, setToken } from "./session";

const platform = vi.hoisted(() => ({ native: true }));
const preferences = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
const filesystem = vi.hoisted(() => ({ writeFile: vi.fn(), readFile: vi.fn(), deleteFile: vi.fn() }));
const localNotifications = vi.hoisted(() => ({
  schedule: vi.fn(),
  cancel: vi.fn(),
  checkPermissions: vi.fn(),
  addListener: vi.fn(),
}));
const haptics = vi.hoisted(() => ({ impact: vi.fn(), notification: vi.fn() }));

vi.mock("./platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("@capacitor/local-notifications", () => ({ LocalNotifications: localNotifications }));
vi.mock("@capacitor/haptics", () => ({
  Haptics: haptics,
  ImpactStyle: { Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS" },
}));
// Le spie chiamano l'implementazione vera: i test di integrazione usano i moduli reali.
vi.mock("./connectivity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./connectivity")>();
  return { ...actual, startConnectivityRecovery: vi.fn(actual.startConnectivityRecovery) };
});
vi.mock("./prefetchScheduler", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prefetchScheduler")>();
  return { ...actual, startPrefetch: vi.fn(actual.startPrefetch) };
});
vi.mock("./gymSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./gymSync")>();
  return { ...actual, startGymSync: vi.fn(actual.startGymSync) };
});
// La campanella è una richiesta a /sounds: la escludiamo, così la prima richiesta di fetch è /auth/me.
vi.mock("./restNotifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./restNotifications")>();
  return { ...actual, installNotificationSound: vi.fn(async () => undefined) };
});

const UNAUTHORIZED: Reply = { status: 401, body: { detail: "unauthorized" } };
const ME = meWith(["workouts.use", "diary.copy"]);

let queryClient: QueryClient;
let routed: ReturnType<typeof routeFetch>;

// /auth/me risponde solo alla sessione attiva: dopo la rimozione del token non torna nessun utente.
function meReply({ init }: RouteContext): Reply {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization === "Bearer tok-a" ? { status: 200, body: ME } : UNAUTHORIZED;
}

function setupFetch(overrides: Parameters<typeof routeFetch>[0] = {}): void {
  routed = routeFetch({ "/auth/me": meReply, ...overrides });
  vi.stubGlobal("fetch", routed.fetch);
}

// Come App: QueryClientProvider, Router, AuthProvider (che usa useMe), poi bridge e servizi nativi.
function app(client: QueryClient): ReactNode {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <NativeBridge />
          <NativeOfflineServices />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// Avanza il tempo finto e lascia girare le promise.
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// Fa girare il giro fino a quando non parte più nessuna richiesta.
async function settle(): Promise<void> {
  let seen = -1;
  while (seen !== routed.urls.length) {
    seen = routed.urls.length;
    await advance(0);
  }
}

beforeEach(() => {
  platform.native = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 13, 10, 0));
  vi.clearAllMocks();
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue(undefined);
  filesystem.deleteFile.mockResolvedValue(undefined);
  localNotifications.addListener.mockResolvedValue({ remove: vi.fn() });
  queryClient = createQueryClient(true);
  queryClient.mount();
});

afterEach(async () => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  resetPrefetchSchedulerForTests();
  resetConnectivityForTests();
  await clearToken();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NativeOfflineServices sul montaggio", () => {
  it("nativo: avvia ripresa e precarico una volta ciascuno e li ferma allo smontaggio", () => {
    setupFetch();
    const stopRecovery = vi.fn();
    const stopPrefetch = vi.fn();
    vi.mocked(startConnectivityRecovery).mockReturnValueOnce(stopRecovery);
    vi.mocked(startPrefetch).mockReturnValueOnce(stopPrefetch);

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <NativeOfflineServices />
      </QueryClientProvider>,
    );
    expect(startConnectivityRecovery).toHaveBeenCalledTimes(1);
    expect(startPrefetch).toHaveBeenCalledTimes(1);
    expect(startPrefetch).toHaveBeenCalledWith(queryClient);
    expect(stopRecovery).not.toHaveBeenCalled();
    expect(stopPrefetch).not.toHaveBeenCalled();

    unmount();
    expect(stopRecovery).toHaveBeenCalledTimes(1);
    expect(stopPrefetch).toHaveBeenCalledTimes(1);
  });

  it("nativo: avvia il sync della palestra con il client di React Query e lo ferma allo smontaggio", () => {
    setupFetch();
    const stopGymSync = vi.fn();
    vi.mocked(startGymSync).mockReturnValueOnce(stopGymSync);

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <NativeOfflineServices />
      </QueryClientProvider>,
    );
    expect(startGymSync).toHaveBeenCalledTimes(1);
    expect(startGymSync).toHaveBeenCalledWith(queryClient);
    expect(stopGymSync).not.toHaveBeenCalled();

    unmount();
    expect(stopGymSync).toHaveBeenCalledTimes(1);
  });

  it("web: non avvia né la ripresa né il precarico né il sync", () => {
    setupFetch();
    platform.native = false;

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <NativeOfflineServices />
      </QueryClientProvider>,
    );
    unmount();
    expect(startConnectivityRecovery).not.toHaveBeenCalled();
    expect(startPrefetch).not.toHaveBeenCalled();
    expect(startGymSync).not.toHaveBeenCalled();
    expect(routed.urls).toEqual([]);
  });
});

describe("precarico avviato dai servizi nativi", () => {
  beforeEach(async () => {
    await setToken("tok-a");
  });

  it("la prima richiesta è /auth/me e il giro parte solo dopo la sua risposta e 2 secondi di idle", async () => {
    setupFetch();
    render(app(queryClient));
    expect(routed.fetch.mock.calls[0]?.[0]).toBe("/api/auth/me");
    expect(routed.urls).toEqual(["/auth/me"]);

    await advance(1999);
    expect(routed.urls).toEqual(["/auth/me"]);

    await advance(1);
    await settle();
    expect(routed.urls).toEqual(
      expect.arrayContaining([
        "/diary/day/2026-10-13",
        "/diary/day/2026-10-12",
        "/stats/streak",
        "/weights/today",
        "/workouts?limit=20",
        "/saved-weeks",
      ]),
    );
  });

  it("C8: il giro non programma né cancella notifiche, non vibra e non tocca il workout attivo", async () => {
    setupFetch();
    render(app(queryClient));
    await advance(0);
    // Il mount può aver chiamato i plugin: si conta solo quello che fa il giro.
    vi.clearAllMocks();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await advance(2000);
    await settle();

    expect(routed.urls).toContain("/workouts/25");
    expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    expect(LocalNotifications.cancel).not.toHaveBeenCalled();
    expect(Haptics.impact).not.toHaveBeenCalled();
    expect(Haptics.notification).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(gymKeys.active)).toBeUndefined();
    const workoutInvalidations = invalidate.mock.calls.filter(([filters]) => {
      const key = filters?.queryKey ?? [];
      return key[0] === "gym" && key[1] === "workout";
    });
    expect(workoutInvalidations).toEqual([]);
  });

  it("C21: un 401 di sessione durante il giro rimuove token e utente, e il giro si ferma", async () => {
    setupFetch({
      "*": ({ path }) => (path.startsWith("/diary/day/") ? UNAUTHORIZED : undefined),
    });
    render(app(queryClient));
    await advance(0);
    await advance(2000);
    await settle();

    expect(getToken()).toBeNull();
    expect(queryClient.getQueryData(["me"])).toBeNull();
    expect(preferences.remove).toHaveBeenCalled();
    expect(filesystem.deleteFile).toHaveBeenCalled();

    const count = routed.urls.length;
    await settle();
    expect(routed.urls).toHaveLength(count);
  });
});
