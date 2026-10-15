import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareNativeSession } from "./boot";

// File separato da boot.test.ts: quei test restano invariati (C47).
const session = vi.hoisted(() => ({
  loadNativeSession: vi.fn(),
  getToken: vi.fn(),
}));
const persistence = vi.hoisted(() => ({
  restoreQueryCache: vi.fn(),
  startQueryPersistence: vi.fn(),
  clearPersistedQueryCache: vi.fn(),
}));
const gym = vi.hoisted(() => ({ loadGymStore: vi.fn() }));

vi.mock("./session", () => session);
vi.mock("./queryPersistence", () => persistence);
vi.mock("./gymStore", () => gym);
vi.mock("./platform", () => ({ isNative: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  session.loadNativeSession.mockResolvedValue(undefined);
  session.getToken.mockReturnValue("tok-di-test");
  persistence.restoreQueryCache.mockResolvedValue(undefined);
  persistence.clearPersistedQueryCache.mockResolvedValue(undefined);
  gym.loadGymStore.mockResolvedValue(undefined);
});

describe("prepareNativeSession e lo stato locale della palestra", () => {
  it("carica lo stato locale dopo la sessione anche senza token", async () => {
    session.getToken.mockReturnValue(null);

    await prepareNativeSession(new QueryClient());

    expect(gym.loadGymStore).toHaveBeenCalledOnce();
    const sessionOrder = session.loadNativeSession.mock.invocationCallOrder[0];
    const gymOrder = gym.loadGymStore.mock.invocationCallOrder[0];
    expect(sessionOrder).toBeLessThan(gymOrder);
  });

  it("se loadGymStore rifiuta, la cache e le scritture partono lo stesso", async () => {
    gym.loadGymStore.mockRejectedValue(new Error("disco pieno"));
    const queryClient = new QueryClient();

    await expect(prepareNativeSession(queryClient)).resolves.toBeUndefined();

    expect(persistence.restoreQueryCache).toHaveBeenCalledWith(queryClient);
    expect(persistence.startQueryPersistence).toHaveBeenCalledWith(queryClient);
  });
});
