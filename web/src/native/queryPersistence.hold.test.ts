import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const preferences = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));
const filesystem = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  stat: vi.fn(),
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

async function loadModules() {
  vi.resetModules();
  const session = await import("./session");
  const persistence = await import("./queryPersistence");
  return { session, persistence };
}

// Cinque eventi della QueryCache, come le risposte di una pagina che si apre.
function emitQueryEvents(queryClient: QueryClient): void {
  for (let day = 1; day <= 5; day++) {
    queryClient.setQueryData(["diary", "day", `2026-10-0${day}`], { date: `2026-10-0${day}`, entries: [] });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  preferences.get.mockResolvedValue({ value: TOKEN });
  preferences.set.mockResolvedValue(undefined);
  preferences.remove.mockResolvedValue(undefined);
  filesystem.writeFile.mockResolvedValue({ uri: "file:///query-cache.json" });
  filesystem.readFile.mockRejectedValue(new Error("File does not exist"));
  filesystem.deleteFile.mockResolvedValue(undefined);
  filesystem.stat.mockResolvedValue({ size: 430080, mtime: 123 });
  platform.native = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("holdQueryPersistence on the native platform", () => {
  it("defers the writes while a hold is active and writes once after the release", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = new QueryClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    const release = persistence.holdQueryPersistence();
    emitQueryEvents(queryClient);
    await vi.advanceTimersByTimeAsync(5000);
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).not.toHaveBeenCalled();

    release();
    await vi.advanceTimersByTimeAsync(1000);
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not let a second call to release lower the count of the other holds", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = new QueryClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    const first = persistence.holdQueryPersistence();
    const second = persistence.holdQueryPersistence();
    first();
    first();
    emitQueryEvents(queryClient);
    await vi.advanceTimersByTimeAsync(5000);
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).not.toHaveBeenCalled();

    second();
    await vi.advanceTimersByTimeAsync(1000);
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    stop();
  });

  it("defers a write that was already scheduled when the hold starts", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = new QueryClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    queryClient.setQueryData(["me"], ME);
    const release = persistence.holdQueryPersistence();
    await vi.advanceTimersByTimeAsync(5000);
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).not.toHaveBeenCalled();

    release();
    await vi.advanceTimersByTimeAsync(1000);
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    stop();
  });

  it("writes at once when the app goes to the background during a hold", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = new QueryClient();

    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    const stop = persistence.startQueryPersistence(queryClient);
    const release = persistence.holdQueryPersistence();
    emitQueryEvents(queryClient);
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);

    // La scrittura di sfondo ha già salvato le modifiche: il rilascio non ne programma un'altra.
    release();
    await vi.advanceTimersByTimeAsync(1000);
    await persistence.flushQueryPersistenceForTests();
    expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not write at the release when there is no token", async () => {
    const { persistence } = await loadModules();
    const queryClient = new QueryClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    const release = persistence.holdQueryPersistence();
    queryClient.setQueryData(["me"], ME);
    release();
    await vi.advanceTimersByTimeAsync(5000);
    await persistence.flushQueryPersistenceForTests();

    expect(filesystem.writeFile).not.toHaveBeenCalled();
    stop();
  });

  it("drops the deferred write when the cache is cleared during a hold", async () => {
    const { session, persistence } = await loadModules();
    await session.loadNativeSession();
    const queryClient = new QueryClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    const release = persistence.holdQueryPersistence();
    queryClient.setQueryData(["me"], ME);
    await persistence.clearPersistedQueryCache();
    release();
    await vi.advanceTimersByTimeAsync(5000);
    await persistence.flushQueryPersistenceForTests();

    expect(filesystem.writeFile).not.toHaveBeenCalled();
    expect(filesystem.deleteFile).toHaveBeenCalledWith({ path: CACHE_PATH, directory: "LIBRARY" });
    stop();
  });

  it("is a no-op on the web", async () => {
    platform.native = false;
    const { persistence } = await loadModules();
    const queryClient = new QueryClient();

    vi.useFakeTimers();
    const stop = persistence.startQueryPersistence(queryClient);
    const release = persistence.holdQueryPersistence();
    expect(() => release()).not.toThrow();
    queryClient.setQueryData(["me"], ME);
    await vi.advanceTimersByTimeAsync(5000);
    await persistence.flushQueryPersistenceForTests();

    expect(filesystem.writeFile).not.toHaveBeenCalled();
    stop();
  });
});

describe("getPersistedCacheInfo", () => {
  it("returns the size in bytes and the modification time of the cache file", async () => {
    const { persistence } = await loadModules();

    await expect(persistence.getPersistedCacheInfo()).resolves.toEqual({ sizeBytes: 430080, savedAt: 123 });
    expect(filesystem.stat).toHaveBeenCalledWith({ path: CACHE_PATH, directory: "LIBRARY" });
  });

  it("returns null when the file cannot be read", async () => {
    filesystem.stat.mockRejectedValue(new Error("File does not exist"));
    const { persistence } = await loadModules();

    await expect(persistence.getPersistedCacheInfo()).resolves.toBeNull();
  });

  it("returns null on the web without calling the filesystem", async () => {
    platform.native = false;
    const { persistence } = await loadModules();

    await expect(persistence.getPersistedCacheInfo()).resolves.toBeNull();
    expect(filesystem.stat).not.toHaveBeenCalled();
  });
});
