import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Me, getMe, logout } from "../api/auth";
import { ApiError, NetworkError, client } from "../api/client";
import type { Exercise, Template, WorkoutPutBody } from "../api/gym";
import { resetConnectivityForTests } from "../native/connectivity";
import { clearGymStore, dispatch, getSnapshot, setClockOffset, startWorkoutFromTemplate } from "../native/gymStore";
import { startGymSync } from "../native/gymSync";
import { clearToken, getToken, setToken } from "../native/session";
import { useLogout, useMe } from "./AuthContext";

const platform = vi.hoisted(() => ({ native: true }));
const preferences = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() }));
const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
}));
const api = vi.hoisted(() => ({ fetchActiveWorkout: vi.fn(), putWorkout: vi.fn() }));

vi.mock("../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("../api/gym", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/gym")>()),
  fetchActiveWorkout: api.fetchActiveWorkout,
  putWorkout: api.putWorkout,
}));
vi.mock("../api/auth", () => ({ getMe: vi.fn(), logout: vi.fn() }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: vi.fn() };
});
vi.mock("../lib/push", () => ({ unsubscribeDeviceOnLogout: vi.fn() }));
vi.mock("../native/restNotifications", () => ({
  cancelRestNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../native/queryPersistence", () => ({
  clearPersistedQueryCache: vi.fn().mockResolvedValue(undefined),
}));

const STORE_PATH = "yfp/gym-local.json";
const SETTLE_MS = 1000;
const logoutMock = vi.mocked(logout);
const getMeMock = vi.mocked(getMe);
const useNavigateMock = vi.mocked(useNavigate);

const PANCA: Exercise = {
  id: 1,
  name: "Panca piana",
  equipment: "bilanciere",
  primary_muscles: ["petto"],
  secondary_muscles: [],
  category: null,
  tracking: "weight_reps",
  custom: false,
};

const TEMPLATE: Template = {
  id: 3,
  name: "Giorno A",
  folder_id: null,
  last_used_at: null,
  exercises: [
    {
      id: 11,
      exercise: PANCA,
      rest_seconds: 120,
      superset_group: null,
      note: null,
      sets: [{ weight_kg: 50, reps: 8, duration_s: null }],
    },
  ],
};

let queryClient: QueryClient;
let stop: (() => void) | undefined;
let confirmSpy: MockInstance<typeof window.confirm>;
let token = "";
let tokenCount = 0;

function me(id: number): Me {
  return { id, username: `utente${id}`, display_name: `Utente ${id}`, role: "user", permissions: [], mcp_url: "" };
}

// Un token nuovo per ogni sessione del test: la conferma di `["me"]` vale solo per il token che l'ha ricevuta.
async function newSession(): Promise<void> {
  tokenCount += 1;
  token = `tok-${tokenCount}`;
  await setToken(token);
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// Monta `["me"]`: la risposta riuscita conferma l'utente dello stato locale per il token in uso.
async function mountMe(id: number): Promise<void> {
  getMeMock.mockResolvedValueOnce(me(id));
  renderHook(() => useMe(), { wrapper });
  await waitFor(() => expect(queryClient.getQueryData(["me"])).toEqual(me(id)));
}

// Un'altra `["me"]` riuscita, con il token in uso.
async function refreshMe(id: number): Promise<void> {
  getMeMock.mockResolvedValueOnce(me(id));
  await act(async () => {
    await queryClient.refetchQueries({ queryKey: ["me"], exact: true });
  });
}

function renderLogout() {
  const navigate = vi.fn();
  useNavigateMock.mockReturnValue(navigate);
  const { result } = renderHook(() => useLogout(), { wrapper });
  return { logout: result.current, navigate };
}

function finishedLocally(): string {
  const started = startWorkoutFromTemplate(TEMPLATE);
  if (!started.ok) throw new Error(started.error);
  const uuid = started.state.uuid;
  const setUuid = getSnapshot().active?.workout.exercises[0].sets[0].uuid ?? "";
  expect(dispatch(uuid, { type: "completeSet", setUuid, values: { weight_kg: 50, reps: 8, duration_s: null } }).ok).toBe(true);
  expect(dispatch(uuid, { type: "finish", discardIncomplete: false }).ok).toBe(true);
  return uuid;
}

// Risponde 401 con il dettaglio di sessione scaduta: il client rimuove il token e basta.
async function expireSession(): Promise<void> {
  const response = new Response(JSON.stringify({ detail: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  try {
    await expect(client.get("/auth/me")).rejects.toBeInstanceOf(ApiError);
  } finally {
    vi.unstubAllGlobals();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(async () => {
  platform.native = true;
  preferences.get.mockResolvedValue({ value: null });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue(undefined);
  filesystem.deleteFile.mockResolvedValue(undefined);
  filesystem.rename.mockResolvedValue(undefined);
  filesystem.stat.mockResolvedValue({});
  api.fetchActiveWorkout.mockReset();
  api.fetchActiveWorkout.mockResolvedValue(null);
  api.putWorkout.mockReset();
  api.putWorkout.mockRejectedValue(new NetworkError("offline"));
  vi.clearAllMocks();
  logoutMock.mockResolvedValue(undefined);
  getMeMock.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  await clearGymStore();
  // Lo svuotamento della fase di preparazione non conta per i test: si riparte con le chiamate a zero.
  filesystem.deleteFile.mockClear();
  await clearToken();
  await newSession();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  confirmSpy.mockRestore();
  resetConnectivityForTests();
});

describe("logout nell'IPA con allenamenti non sincronizzati (R21, C34)", () => {
  it("con N = 1 chiede conferma e, annullando, non fa nulla", async () => {
    finishedLocally();
    confirmSpy.mockReturnValue(false);
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(confirmSpy).toHaveBeenCalledWith("Ci sono 1 allenamenti non sincronizzati: uscendo andranno persi");
    expect(logoutMock).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(getToken()).toBe(token);
    expect(getSnapshot().finished).toHaveLength(1);
    expect(filesystem.deleteFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: STORE_PATH }));
  });

  it("confermando cancella il file locale prima del flusso di uscita", async () => {
    finishedLocally();
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(getSnapshot().finished).toHaveLength(0);
    expect(filesystem.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ path: STORE_PATH }));
    expect(logoutMock).toHaveBeenCalledOnce();
    expect(filesystem.deleteFile.mock.invocationCallOrder[0]).toBeLessThan(logoutMock.mock.invocationCallOrder[0]);
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(getToken()).toBeNull();
  });

  it("un allenamento attivo con modifiche in attesa conta come non sincronizzato", async () => {
    const started = startWorkoutFromTemplate(TEMPLATE);
    expect(started.ok).toBe(true);
    confirmSpy.mockReturnValue(false);
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(confirmSpy).toHaveBeenCalledWith("Ci sono 1 allenamenti non sincronizzati: uscendo andranno persi");
    expect(navigate).not.toHaveBeenCalled();
    expect(getSnapshot().active).not.toBeNull();
  });

  it("senza allenamenti non sincronizzati non chiede nulla e prosegue", async () => {
    const { logout: runLogout, navigate } = renderLogout();

    await act(async () => {
      await runLogout();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(logoutMock).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
  });
});

describe("401 di sessione e cambio utente (R21, C34)", () => {
  it("un 401 lascia il file locale e, dopo il login dello stesso utente, il sync riparte", async () => {
    await mountMe(7);
    const uuid = finishedLocally();
    await expireSession();

    expect(getToken()).toBeNull();
    expect(getSnapshot().finished).toHaveLength(1);
    expect(filesystem.deleteFile).not.toHaveBeenCalledWith(expect.objectContaining({ path: STORE_PATH }));

    stop = startGymSync(queryClient);
    await newSession();
    // Un token nuovo, non ancora confermato da `["me"]`: il sync non invia, neanche dopo il ritardo di quiete.
    setClockOffset(1000);
    await wait(SETTLE_MS + 100);
    expect(api.putWorkout).not.toHaveBeenCalled();

    await refreshMe(7);
    await waitFor(() => expect(api.putWorkout).toHaveBeenCalledWith(uuid, expect.objectContaining({ base_version: null })));
    const body = api.putWorkout.mock.calls[0]?.[1] as WorkoutPutBody;
    expect(body.status).toBe("finished");
  });

  it("un utente diverso svuota lo stato senza inviarlo", async () => {
    await mountMe(7);
    finishedLocally();
    await expireSession();

    stop = startGymSync(queryClient);
    await newSession();
    await refreshMe(8);
    await wait(SETTLE_MS + 100);

    expect(getSnapshot()).toMatchObject({ userId: 8, active: null, finished: [] });
    expect(api.putWorkout).not.toHaveBeenCalled();
    expect(filesystem.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ path: STORE_PATH }));
  });
});
