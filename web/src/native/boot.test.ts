import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { prepareNativeSession } from "./boot";

const session = vi.hoisted(() => ({
  loadNativeSession: vi.fn(),
  getToken: vi.fn(),
}));
const persistence = vi.hoisted(() => ({
  restoreQueryCache: vi.fn(),
  startQueryPersistence: vi.fn(),
  clearPersistedQueryCache: vi.fn(),
}));
const platform = vi.hoisted(() => ({ native: true }));

vi.mock("./session", () => session);
vi.mock("./queryPersistence", () => persistence);
vi.mock("./platform", () => ({ isNative: () => platform.native }));

beforeEach(() => {
  vi.clearAllMocks();
  session.loadNativeSession.mockResolvedValue(undefined);
  session.getToken.mockReturnValue("tok-di-test");
  persistence.restoreQueryCache.mockResolvedValue(undefined);
  persistence.clearPersistedQueryCache.mockResolvedValue(undefined);
  platform.native = true;
});

describe("prepareNativeSession (native platform)", () => {
  it("con token carica la sessione, ripristina la cache e poi avvia le scritture", async () => {
    const queryClient = new QueryClient();

    await prepareNativeSession(queryClient);

    expect(session.loadNativeSession).toHaveBeenCalledOnce();
    expect(persistence.restoreQueryCache).toHaveBeenCalledWith(queryClient);
    expect(persistence.startQueryPersistence).toHaveBeenCalledWith(queryClient);
    const loadOrder = session.loadNativeSession.mock.invocationCallOrder[0];
    const restoreOrder = persistence.restoreQueryCache.mock.invocationCallOrder[0];
    const startOrder = persistence.startQueryPersistence.mock.invocationCallOrder[0];
    expect(loadOrder).toBeLessThan(restoreOrder);
    expect(restoreOrder).toBeLessThan(startOrder);
    expect(persistence.clearPersistedQueryCache).not.toHaveBeenCalled();
  });

  it("senza token cancella la cache persistente e non la ripristina", async () => {
    session.getToken.mockReturnValue(null);
    const queryClient = new QueryClient();

    await prepareNativeSession(queryClient);

    expect(persistence.clearPersistedQueryCache).toHaveBeenCalledOnce();
    expect(persistence.restoreQueryCache).not.toHaveBeenCalled();
    expect(persistence.startQueryPersistence).toHaveBeenCalledWith(queryClient);
  });

  it("se il ripristino rifiuta risolve comunque e avvia le scritture", async () => {
    persistence.restoreQueryCache.mockRejectedValue(new Error("disco pieno"));
    const queryClient = new QueryClient();

    await expect(prepareNativeSession(queryClient)).resolves.toBeUndefined();

    expect(persistence.startQueryPersistence).toHaveBeenCalledWith(queryClient);
  });

  it("se la lettura della sessione rifiuta risolve e tratta l'utente come senza token", async () => {
    session.loadNativeSession.mockRejectedValue(new Error("preferences"));
    session.getToken.mockReturnValue(null);
    const queryClient = new QueryClient();

    await expect(prepareNativeSession(queryClient)).resolves.toBeUndefined();

    expect(persistence.restoreQueryCache).not.toHaveBeenCalled();
    expect(persistence.clearPersistedQueryCache).toHaveBeenCalledOnce();
    expect(persistence.startQueryPersistence).toHaveBeenCalledWith(queryClient);
  });
});

describe("prepareNativeSession (web)", () => {
  it("non ripristina e non cancella nulla", async () => {
    platform.native = false;
    session.getToken.mockReturnValue(null);

    await prepareNativeSession(new QueryClient());

    expect(persistence.restoreQueryCache).not.toHaveBeenCalled();
    expect(persistence.clearPersistedQueryCache).not.toHaveBeenCalled();
  });
});
