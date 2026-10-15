import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Exercise, Template } from "../api/gym";
import { client } from "../api/client";
import { createQueryClient } from "../lib/queryClient";
import { reportNetworkFailure, reportNetworkSuccess, resetConnectivityForTests } from "../native/connectivity";
import { clearGymStore, dispatch, startWorkoutFromTemplate } from "../native/gymStore";
import NativeOfflineServices from "../native/NativeOfflineServices";
import OfflineIndicator from "./OfflineIndicator";

const platform = vi.hoisted(() => ({ native: true }));

vi.mock("../native/platform", () => ({ isNative: () => platform.native }));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: {
    writeFile: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    deleteFile: vi.fn(),
    rename: vi.fn(),
  },
  Directory: { Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
}));

const fetchMock = vi.fn<typeof fetch>();

let queryClient: QueryClient;

// Risposta minimale: il client usa solo ok, status e json().
function response(status: number, body?: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: () => (body === undefined ? Promise.reject(new SyntaxError("no json")) : Promise.resolve(body)),
  } as unknown as Response;
}

// Schermata con la query "diary": quando staleTime è 0 la query parte al montaggio.
function DiaryPage({ staleTime }: { staleTime: number }) {
  const diary = useQuery({
    queryKey: ["diary"],
    queryFn: () => client.get<string>("/diary"),
    staleTime,
  });
  return <div>{`Diary ${diary.data ?? ""}`}</div>;
}

function renderPage(staleTime = Infinity) {
  return render(
    <QueryClientProvider client={queryClient}>
      <NativeOfflineServices />
      <OfflineIndicator />
      <DiaryPage staleTime={staleTime} />
    </QueryClientProvider>,
  );
}

// Come AuthProvider: la query ["me"] è sempre osservata, con staleTime lungo.
function MeObserver() {
  useQuery({ queryKey: ["me"], queryFn: () => client.get<string>("/auth/me"), staleTime: Infinity });
  return null;
}

function localTime(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month, day, hour, minute).getTime();
}

function indicatorButton(text: RegExp) {
  return screen.queryByRole("button", { name: text });
}

beforeEach(() => {
  platform.native = true;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 15, 0));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  queryClient = createQueryClient(true);
  queryClient.mount();
});

afterEach(() => {
  cleanup();
  queryClient.unmount();
  queryClient.clear();
  resetConnectivityForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("OfflineIndicator sull'IPA", () => {
  it("mostra il puntino con l'ora dei dati quando la rete manca, e il testo solo dopo il tocco", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();

    act(() => reportNetworkFailure());

    expect(screen.getByRole("button", { name: /Offline, dati delle 14:05/ })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Offline, dati delle 14:05/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Offline, dati delle 14:05");
  });

  it("sparisce quando la rete torna", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();
    act(() => reportNetworkFailure());

    act(() => reportNetworkSuccess());

    expect(indicatorButton(/Offline/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("non compare con la rete presente", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();

    expect(indicatorButton(/Offline/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("non compare senza query con dati", () => {
    // La query parte senza dati e resta in attesa: nessuna risposta arriva durante il test.
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));
    renderPage();

    act(() => reportNetworkFailure());

    expect(indicatorButton(/Offline/)).not.toBeInTheDocument();
  });

  it("tocchi successivi alternano il fumetto", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();
    act(() => reportNetworkFailure());
    const button = screen.getByRole("button", { name: /Offline, dati delle 14:05/ });

    fireEvent.click(button);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("il fumetto si chiude da solo dopo 4000 ms", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();
    act(() => reportNetworkFailure());
    fireEvent.click(screen.getByRole("button", { name: /Offline, dati delle 14:05/ }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("non ha elementi fixed, né col puntino né col fumetto aperto", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    const { container } = renderPage();
    act(() => reportNetworkFailure());
    expect(container.querySelector(".fixed")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Offline, dati delle 14:05/ }));

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelector(".fixed")).toBeNull();
  });

  it("R16: con la query me più vecchia di un'altra mostra l'ora dell'altra", () => {
    queryClient.setQueryData(["me"], "utente", { updatedAt: localTime(2026, 9, 12, 9, 0) });
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    render(
      <QueryClientProvider client={queryClient}>
        <NativeOfflineServices />
        <OfflineIndicator />
        <MeObserver />
        <DiaryPage staleTime={Infinity} />
      </QueryClientProvider>,
    );

    act(() => reportNetworkFailure());

    expect(screen.getByRole("button", { name: /Offline, dati delle 14:05/ })).toBeInTheDocument();
  });

  it("R16: con la sola query me mostra l'ora della query me", () => {
    queryClient.setQueryData(["me"], "utente", { updatedAt: localTime(2026, 9, 12, 9, 0) });
    render(
      <QueryClientProvider client={queryClient}>
        <NativeOfflineServices />
        <OfflineIndicator />
        <MeObserver />
      </QueryClientProvider>,
    );

    act(() => reportNetworkFailure());

    expect(screen.getByRole("button", { name: /Offline, dati delle 09:00/ })).toBeInTheDocument();
  });

  it("indica il giorno quando i dati non sono di oggi", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 11, 9, 30) });
    renderPage();

    act(() => reportNetworkFailure());
    fireEvent.click(screen.getByRole("button", { name: /Offline, dati del 11\/10 alle 09:30/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Offline, dati del 11/10 alle 09:30");
  });

  it("evento offline della finestra: il puntino compare", () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByRole("button", { name: /Offline, dati delle 14:05/ })).toBeInTheDocument();
  });

  it("C5: quando la rete torna la schermata si aggiorna da sola e il puntino sparisce", async () => {
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage(0);
    const query = queryClient.getQueryCache().find({ queryKey: ["diary"] })!;
    // Il primo tentativo fallisce, poi il retryer attende 1 s e va in pausa perché la rete manca.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(query.state.fetchStatus).toBe("paused");
    expect(screen.getByRole("button", { name: /Offline, dati delle 14:05/ })).toBeInTheDocument();
    expect(screen.getByText("Diary vecchi")).toBeInTheDocument();

    fetchMock.mockResolvedValue(response(200, "nuovi"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(screen.getByText("Diary nuovi")).toBeInTheDocument();
    expect(indicatorButton(/Offline/)).not.toBeInTheDocument();
  });

  it("C2: con l'app che torna in primo piano la ripresa avviene subito", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(indicatorButton(/Offline, dati delle 14:05/)).toBeInTheDocument();

    fetchMock.mockResolvedValue(response(200, "nuovi"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText("Diary nuovi")).toBeInTheDocument();
    expect(indicatorButton(/Offline/)).not.toBeInTheDocument();
  });
});

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

const PUSH: Template = {
  id: 3,
  name: "Push A",
  folder_id: null,
  last_used_at: null,
  exercises: [
    {
      id: 11,
      exercise: PANCA,
      rest_seconds: 90,
      superset_group: null,
      note: null,
      sets: [{ weight_kg: 80, reps: 8, duration_s: null }],
    },
  ],
};

/** Un allenamento finito solo sul telefono. */
function finishedLocally() {
  const started = startWorkoutFromTemplate(PUSH);
  if (!started.ok) throw new Error(started.error);
  const { uuid, exercises } = started.state;
  const done = dispatch(uuid, {
    type: "completeSet",
    setUuid: exercises[0].sets[0].uuid,
    values: { weight_kg: 80, reps: 8, duration_s: null },
  });
  if (!done.ok) throw new Error(done.error);
  const finished = dispatch(uuid, { type: "finish", discardIncomplete: true });
  if (!finished.ok) throw new Error(finished.error);
}

// Solo il puntino, senza NativeOfflineServices: il sync non deve partire in questi test.
function DiaryObserver() {
  useQuery({ queryKey: ["diary"], queryFn: () => new Promise<string>(() => undefined), enabled: false });
  return null;
}

describe("OfflineIndicator con allenamenti da sincronizzare (C36)", () => {
  beforeEach(async () => {
    await clearGymStore();
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
  });

  it("il fumetto termina con '· N da sincronizzare'", () => {
    finishedLocally();
    finishedLocally();
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineIndicator />
        <DiaryObserver />
      </QueryClientProvider>,
    );

    act(() => reportNetworkFailure());
    const dot = screen.getByRole("button", { name: /· 2 da sincronizzare$/ });
    fireEvent.click(dot);

    expect(screen.getByRole("status")).toHaveTextContent(/· 2 da sincronizzare$/);
  });

  it("senza allenamenti da sincronizzare il testo è quello di sempre", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineIndicator />
        <DiaryObserver />
      </QueryClientProvider>,
    );

    act(() => reportNetworkFailure());

    expect(screen.getByRole("button", { name: /Offline, dati delle 14:05$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /da sincronizzare/ })).not.toBeInTheDocument();
  });
});

describe("OfflineIndicator nel browser", () => {
  it("non rende nulla e non avvia il ripristino della connessione", () => {
    platform.native = false;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    queryClient.setQueryData(["diary"], "vecchi", { updatedAt: localTime(2026, 9, 12, 14, 5) });
    renderPage();

    act(() => reportNetworkFailure());

    expect(indicatorButton(/Offline/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 20000);
  });
});
