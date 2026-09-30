import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

type PushHandler = (event: {
  data?: { json: () => unknown } | null;
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;
type ClickHandler = (event: {
  notification: { close: () => void; data?: { url?: string } };
  waitUntil: (promise: Promise<unknown>) => void;
}) => void;

type FakeClient = {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
};

function loadPushWorker(options: {
  notifications?: Array<{ close: ReturnType<typeof vi.fn> }>;
  getNotifications?: () => Promise<Array<{ close: ReturnType<typeof vi.fn> }>>;
  clients?: FakeClient[];
} = {}) {
  const handlers: Record<string, PushHandler | ClickHandler> = {};
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const getNotifications = options.getNotifications ?? vi.fn().mockResolvedValue(options.notifications ?? []);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const fakeSelf = {
    location: { origin: "https://yfp.example" },
    addEventListener: vi.fn((name: string, handler: PushHandler | ClickHandler) => {
      handlers[name] = handler;
    }),
    registration: { showNotification, getNotifications },
    clients: {
      matchAll: vi.fn().mockResolvedValue(options.clients ?? []),
      openWindow,
    },
  };
  const code = readFileSync(resolve(process.cwd(), "public/push-sw.js"), "utf8");
  new Function("self", code)(fakeSelf);

  return { handlers, showNotification, getNotifications, openWindow, fakeSelf };
}

function push(worker: ReturnType<typeof loadPushWorker>, data?: { json: () => unknown }) {
  let promise: Promise<unknown> | undefined;
  const handler = worker.handlers.push as PushHandler;
  handler({ data, waitUntil: (value) => { promise = value; } });
  return promise!;
}

describe("push service worker", () => {
  it("shows the title from the push payload", async () => {
    const worker = loadPushWorker();
    await push(worker, { json: () => ({ title: "Riposo finito · Push A", url: "/gym/workout" }) });

    expect(worker.showNotification).toHaveBeenCalledWith("Riposo finito · Push A", {
      body: "",
      icon: "/pwa-192x192.png",
      data: { url: "/gym/workout" },
    });
  });

  it("uses the fallback for missing or invalid JSON payloads", async () => {
    for (const data of [undefined, { json: () => { throw new SyntaxError("bad JSON"); } }]) {
      const worker = loadPushWorker();
      await push(worker, data);
      expect(worker.showNotification).toHaveBeenCalledWith("Riposo finito", expect.objectContaining({
        body: "",
        icon: "/pwa-192x192.png",
        data: { url: "/gym/workout" },
      }));
    }
  });

  it("closes previous notifications before showing the new one", async () => {
    const first = { close: vi.fn() };
    const second = { close: vi.fn() };
    const worker = loadPushWorker({ notifications: [first, second] });
    await push(worker, { json: () => ({ title: "Riposo finito · Push A" }) });

    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(first.close.mock.invocationCallOrder[0]).toBeLessThan(worker.showNotification.mock.invocationCallOrder[0]);
    expect(second.close.mock.invocationCallOrder[0]).toBeLessThan(worker.showNotification.mock.invocationCallOrder[0]);
  });

  it("shows the notification when getNotifications throws or is unavailable", async () => {
    const throwingWorker = loadPushWorker({ getNotifications: vi.fn().mockRejectedValue(new Error("unsupported")) });
    await push(throwingWorker, { json: () => ({ title: "Riposo finito · Push A" }) });
    expect(throwingWorker.showNotification).toHaveBeenCalledOnce();

    const workerWithoutGetNotifications = loadPushWorker();
    delete (workerWithoutGetNotifications.fakeSelf.registration as { getNotifications?: unknown }).getNotifications;
    await push(workerWithoutGetNotifications, { json: () => ({ title: "Riposo finito · Push A" }) });
    expect(workerWithoutGetNotifications.showNotification).toHaveBeenCalledOnce();
  });

  it("focuses an existing same-origin client and navigates it to the workout", async () => {
    const client = {
      url: "https://yfp.example/",
      focus: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue(undefined),
    };
    const worker = loadPushWorker({ clients: [client] });
    let promise: Promise<unknown> | undefined;
    const notification = { close: vi.fn(), data: { url: "/gym/workout" } };
    (worker.handlers.notificationclick as ClickHandler)({
      notification,
      waitUntil: (value) => { promise = value; },
    });
    await promise;

    expect(notification.close).toHaveBeenCalledOnce();
    expect(client.focus).toHaveBeenCalledOnce();
    expect(client.navigate).toHaveBeenCalledWith("/gym/workout");
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("opens the workout when there is no existing client", async () => {
    const worker = loadPushWorker();
    let promise: Promise<unknown> | undefined;
    const notification = { close: vi.fn(), data: { url: "/gym/workout" } };
    (worker.handlers.notificationclick as ClickHandler)({
      notification,
      waitUntil: (value) => { promise = value; },
    });
    await promise;

    expect(notification.close).toHaveBeenCalledOnce();
    expect(worker.openWindow).toHaveBeenCalledWith("/gym/workout");
  });
});
