import { dehydrate, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { gymKeys, type Workout } from "../api/gym";

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
}));
const platform = vi.hoisted(() => ({ native: true }));

vi.mock("@capacitor/preferences", () => ({ Preferences: preferences }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystem,
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("./platform", () => ({ isNative: () => platform.native }));

const TOKEN = "tok-segreto-di-test";
const CACHE_PATH = "yfp/query-cache.json";
const ME = { id: 7, username: "simone" };
const DIARY = { date: "2026-10-12", entries: [] };

async function loadModules() {
  vi.resetModules();
  const session = await import("./session");
  const persistence = await import("./queryPersistence");
  return { session, persistence };
}

function activeWorkout(): Workout {
  return {
    id: 1,
    name: "Giorno 1",
    template_id: null,
    status: "in_progress",
    started_at: "2026-10-12T10:00:00.000Z",
    finished_at: null,
    rest_ends_at: "2026-10-12T10:00:30.000Z",
    rest_total_s: 30,
    server_now: "2026-10-12T10:00:00.000Z",
    exercises: [],
    template_diff: [],
  };
}

function writtenPayload(): string {
  const call = filesystem.writeFile.mock.calls.at(-1);
  if (!call) throw new Error("writeFile non chiamato");
  return call[0].data as string;
}

// Cache con le chiavi da escludere e una query in errore, più una mutazione che porta il token.
async function populatedClient(): Promise<QueryClient> {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["me"], ME);
  queryClient.setQueryData(["diary", "day", "2026-10-12"], DIARY);
  queryClient.setQueryData(gymKeys.active, activeWorkout());
  queryClient.setQueryData(["foods", "search", "pasta"], { items: [] });
  queryClient.setQueryData(["admin", "users"], { items: [] });
  await queryClient
    .fetchQuery({ queryKey: ["broken"], queryFn: () => Promise.reject(new Error("boom")), retry: false })
    .catch(() => undefined);
  await queryClient
    .getMutationCache()
    .build(queryClient, { mutationFn: async () => ({ token: TOKEN }) })
    .execute(undefined);
  return queryClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_BUILD_ID", "build-a");
  preferences.get.mockResolvedValue({ value: TOKEN });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue({ uri: "file:///query-cache.json" });
  filesystem.readFile.mockRejectedValue(new Error("File does not exist"));
  filesystem.deleteFile.mockResolvedValue(undefined);
  platform.native = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("query persistence on the native platform", () => {
  it("writes the cache one second after the last query event, when a token is present", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = await populatedClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    queryClient.setQueryData(["me"], ME);
    vi.advanceTimersByTime(999);
    expect(filesystem.writeFile).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    expect(filesystem.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: CACHE_PATH, directory: "LIBRARY", recursive: true, encoding: "utf8" }),
    );
    stop();
  });

  it("does not write when there is no token", async () => {
    const { persistence } = await loadModules();
    const queryClient = await populatedClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    queryClient.setQueryData(["me"], ME);
    vi.advanceTimersByTime(5000);
    await persistence.flushQueryPersistenceForTests();

    expect(filesystem.writeFile).not.toHaveBeenCalled();
    stop();
  });

  it("writes at once when the app goes to the background", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = await populatedClient();

    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    const stop = persistence.startQueryPersistence(queryClient);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await persistence.flushQueryPersistenceForTests();

    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    stop();
  });

  it("writes the buster, the savedAt and only the persistable successful queries, never the token", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = await populatedClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    queryClient.setQueryData(["me"], ME);
    vi.advanceTimersByTime(1000);
    await persistence.flushQueryPersistenceForTests();

    const raw = writtenPayload();
    expect(raw).not.toContain(TOKEN);
    const payload = JSON.parse(raw);
    expect(payload.buster).toBe("1|build-a");
    expect(typeof payload.savedAt).toBe("number");

    const keys = payload.state.queries.map((query: { queryKey: unknown[] }) => JSON.stringify(query.queryKey));
    expect(keys).toContain(JSON.stringify(["me"]));
    expect(keys).toContain(JSON.stringify(["diary", "day", "2026-10-12"]));
    expect(keys).not.toContain(JSON.stringify(gymKeys.active));
    expect(keys.some((key: string) => key.startsWith('["foods"'))).toBe(false);
    expect(keys.some((key: string) => key.startsWith('["admin"'))).toBe(false);
    expect(keys.some((key: string) => key.startsWith('["broken"'))).toBe(false);
    expect(payload.state.mutations).toEqual([]);
    stop();
  });

  it("keeps a query with data after a 502 and writes it as successful", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = new QueryClient();
    queryClient.setQueryData(["me"], ME);
    queryClient.setQueryData(["diary", "day", "2026-10-12"], DIARY);
    await queryClient
      .fetchQuery({
        queryKey: ["me"],
        queryFn: () => Promise.reject(new ApiError(502, "Bad Gateway", "<html>")),
        retry: false,
      })
      .catch(() => undefined);
    expect(queryClient.getQueryState(["me"])?.status).toBe("error");

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    queryClient.setQueryData(["diary", "day", "2026-10-12"], DIARY);
    vi.advanceTimersByTime(1000);
    await persistence.flushQueryPersistenceForTests();
    stop();
    vi.useRealTimers();

    const payload = JSON.parse(writtenPayload());
    const me = payload.state.queries.find(
      (query: { queryKey: unknown[] }) => JSON.stringify(query.queryKey) === JSON.stringify(["me"]),
    );
    expect(me).toBeDefined();
    expect(me.state).toMatchObject({ status: "success", fetchStatus: "idle", error: null, data: ME });

    filesystem.readFile.mockResolvedValue({ data: writtenPayload() });
    const restored = new QueryClient();
    await persistence.restoreQueryCache(restored);
    expect(restored.getQueryState(["me"])?.status).toBe("success");
    expect(restored.getQueryData(["me"])).toEqual(ME);
  });

  it("does not write a query that is in error without data", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = new QueryClient();
    queryClient.setQueryData(["diary", "day", "2026-10-12"], DIARY);
    await queryClient
      .fetchQuery({
        queryKey: ["diary", "week"],
        queryFn: () => Promise.reject(new ApiError(502, "Bad Gateway", "")),
        retry: false,
      })
      .catch(() => undefined);

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    queryClient.setQueryData(["diary", "day", "2026-10-12"], DIARY);
    vi.advanceTimersByTime(1000);
    await persistence.flushQueryPersistenceForTests();
    stop();
    vi.useRealTimers();

    const keys = JSON.parse(writtenPayload()).state.queries.map((query: { queryKey: unknown[] }) =>
      JSON.stringify(query.queryKey),
    );
    expect(keys).toContain(JSON.stringify(["diary", "day", "2026-10-12"]));
    expect(keys).not.toContain(JSON.stringify(["diary", "week"]));
  });

  it("restores only persistable queries that carry data, as successful", async () => {
    const { persistence } = await loadModules();
    const source = await populatedClient();
    await source
      .fetchQuery({
        queryKey: ["diary", "week"],
        queryFn: () => Promise.reject(new ApiError(502, "Bad Gateway", "")),
        retry: false,
      })
      .catch(() => undefined);
    const state = dehydrate(source, { shouldDehydrateQuery: () => true });
    filesystem.readFile.mockResolvedValue({
      data: JSON.stringify({ buster: "1|build-a", savedAt: Date.now(), state }),
    });

    const queryClient = new QueryClient();
    await persistence.restoreQueryCache(queryClient);

    expect(queryClient.getQueryState(["me"])?.status).toBe("success");
    expect(queryClient.getQueryData(["me"])).toEqual(ME);
    expect(queryClient.getQueryState(["broken"])).toBeUndefined();
    expect(queryClient.getQueryState(["diary", "week"])).toBeUndefined();
    expect(queryClient.getQueryState(["foods", "search", "pasta"])).toBeUndefined();
    expect(queryClient.getQueryState(["admin", "users"])).toBeUndefined();
  });

  it("clearPersistedQueryCache cancels a pending write and deletes the file", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = await populatedClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    queryClient.setQueryData(["me"], ME);
    await persistence.clearPersistedQueryCache();
    vi.advanceTimersByTime(5000);
    await persistence.flushQueryPersistenceForTests();

    expect(filesystem.writeFile).not.toHaveBeenCalled();
    expect(filesystem.deleteFile).toHaveBeenCalledWith({ path: CACHE_PATH, directory: "LIBRARY" });
    stop();
  });

  it("clearPersistedQueryCache ignores a missing file", async () => {
    const { persistence } = await loadModules();
    filesystem.deleteFile.mockRejectedValue(new Error("File does not exist"));

    await expect(persistence.clearPersistedQueryCache()).resolves.toBeUndefined();
  });

  it("restores the cache when the buster matches and skips the active workout", async () => {
    const { persistence } = await loadModules();
    const source = await populatedClient();
    const state = dehydrate(source, { shouldDehydrateQuery: () => true });
    const file = { buster: "1|build-a", savedAt: Date.now(), state };
    filesystem.readFile.mockResolvedValue({ data: JSON.stringify(file) });

    const queryClient = new QueryClient();
    await persistence.restoreQueryCache(queryClient);

    expect(filesystem.readFile).toHaveBeenCalledWith({
      path: CACHE_PATH,
      directory: "LIBRARY",
      encoding: "utf8",
    });
    expect(queryClient.getQueryData(["me"])).toEqual(ME);
    expect(queryClient.getQueryData(["diary", "day", "2026-10-12"])).toEqual(DIARY);
    expect(queryClient.getQueryData(gymKeys.active)).toBeUndefined();
    expect(filesystem.deleteFile).not.toHaveBeenCalled();
  });

  it("discards the file when the buster differs", async () => {
    const { persistence } = await loadModules();
    const source = await populatedClient();
    const state = dehydrate(source, { shouldDehydrateQuery: () => true });
    filesystem.readFile.mockResolvedValue({ data: JSON.stringify({ buster: "1|build-b", savedAt: Date.now(), state }) });

    const queryClient = new QueryClient();
    await persistence.restoreQueryCache(queryClient);

    expect(queryClient.getQueryData(["me"])).toBeUndefined();
    expect(filesystem.deleteFile).toHaveBeenCalledWith({ path: CACHE_PATH, directory: "LIBRARY" });
  });

  it("discards the file when the JSON is invalid, without throwing", async () => {
    const { persistence } = await loadModules();
    filesystem.readFile.mockResolvedValue({ data: "{non json" });

    const queryClient = new QueryClient();
    await expect(persistence.restoreQueryCache(queryClient)).resolves.toBeUndefined();

    expect(queryClient.getQueryData(["me"])).toBeUndefined();
    expect(filesystem.deleteFile).toHaveBeenCalledWith({ path: CACHE_PATH, directory: "LIBRARY" });
  });

  it("restores nothing and does not throw when there is no cache file yet", async () => {
    const { persistence } = await loadModules();
    filesystem.readFile.mockRejectedValue(new Error("File does not exist"));
    filesystem.deleteFile.mockRejectedValue(new Error("File does not exist"));

    const queryClient = new QueryClient();
    await expect(persistence.restoreQueryCache(queryClient)).resolves.toBeUndefined();
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
  });
});

describe("query persistence on the web", () => {
  it("never calls the filesystem plugin", async () => {
    platform.native = false;
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = await populatedClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    queryClient.setQueryData(["me"], ME);
    vi.advanceTimersByTime(5000);
    document.dispatchEvent(new Event("visibilitychange"));
    await persistence.restoreQueryCache(queryClient);
    await persistence.clearPersistedQueryCache();
    await persistence.flushQueryPersistenceForTests();
    stop();

    expect(filesystem.writeFile).not.toHaveBeenCalled();
    expect(filesystem.readFile).not.toHaveBeenCalled();
    expect(filesystem.deleteFile).not.toHaveBeenCalled();
  });
});
