import { type QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError } from "../api/client";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests, retryConnection } from "../native/connectivity";
import { createQueryClient } from "./queryClient";

const clients: QueryClient[] = [];

// Il QueryClient reale è montato dal Provider: solo così onlineManager riprende le query in pausa.
function track(client: QueryClient): QueryClient {
  client.mount();
  clients.push(client);
  return client;
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.unmount());
  resetConnectivityForTests();
});

describe("createQueryClient sul web", () => {
  it("non imposta queries né mutations nelle opzioni di default", () => {
    const options = createQueryClient(false).getDefaultOptions();

    expect(options.queries).toBeUndefined();
    expect(options.mutations).toBeUndefined();
  });
});

describe("401 di sessione", () => {
  it("un 401 su una query porta [\"me\"] a null", async () => {
    const client = track(createQueryClient(false));
    client.setQueryData(["me"], { id: 1 });

    await expect(
      client.fetchQuery({
        queryKey: ["diary"],
        queryFn: () => Promise.reject(new ApiError(401, "unauthorized", {})),
        retry: false,
      }),
    ).rejects.toThrow();

    expect(client.getQueryData(["me"])).toBeNull();
  });

  it("un 401 su una mutazione porta [\"me\"] a null", async () => {
    const client = track(createQueryClient(false));
    client.setQueryData(["me"], { id: 1 });
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new ApiError(401, "unauthorized", {})),
    });

    await expect(mutation.execute(undefined)).rejects.toThrow();

    expect(client.getQueryData(["me"])).toBeNull();
  });
});

describe("createQueryClient nativo", () => {
  it("imposta gcTime infinito per le query e networkMode always per le mutazioni", () => {
    const options = createQueryClient(true).getDefaultOptions();

    expect(options.queries?.gcTime).toBe(Infinity);
    expect(options.mutations?.networkMode).toBe("always");
  });

  it("una query con dati offline resta in success e va in pausa", async () => {
    const client = track(createQueryClient(true));
    client.setQueryData(["diary"], "vecchi");
    const observer = new QueryObserver(client, {
      queryKey: ["diary"],
      queryFn: () => {
        reportNetworkFailure();
        throw new NetworkError("network");
      },
      retryDelay: 0,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const query = client.getQueryCache().find({ queryKey: ["diary"] })!;

    await vi.waitFor(() => expect(query.state.fetchStatus).toBe("paused"));

    expect(query.state.status).toBe("success");
    expect(query.state.data).toBe("vecchi");
    unsubscribe();
  });

  it("quando la rete torna la query in pausa riparte e mostra i dati nuovi", async () => {
    const client = track(createQueryClient(true));
    client.setQueryData(["diary"], "vecchi");
    let networkUp = false;
    const observer = new QueryObserver(client, {
      queryKey: ["diary"],
      queryFn: () => {
        if (!networkUp) {
          reportNetworkFailure();
          throw new NetworkError("network");
        }
        reportNetworkSuccess();
        return "nuovi";
      },
      retryDelay: 0,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const query = client.getQueryCache().find({ queryKey: ["diary"] })!;
    await vi.waitFor(() => expect(query.state.fetchStatus).toBe("paused"));

    networkUp = true;
    retryConnection();

    await vi.waitFor(() => expect(query.state.data).toBe("nuovi"));
    unsubscribe();
  });

  it("una mutazione offline rifiuta subito e non resta in pausa", async () => {
    const client = track(createQueryClient(true));
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new NetworkError("network")),
    });
    reportNetworkFailure();

    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(NetworkError);

    expect(mutation.state.isPaused).toBe(false);
    expect(mutation.state.status).toBe("error");
  });
});
