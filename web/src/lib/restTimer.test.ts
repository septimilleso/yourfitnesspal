import { beforeEach, describe, expect, it, vi } from "vitest";

import { clockOffsetMs, remainingSeconds } from "./restTimer";

describe("rest timer math", () => {
  it("computes the server clock offset", () => {
    expect(clockOffsetMs("2026-09-24T18:00:10Z", Date.parse("2026-09-24T18:00:00Z"))).toBe(10_000);
  });

  it("counts down using the server clock", () => {
    const ends = "2026-09-24T18:01:30Z";
    const client = Date.parse("2026-09-24T18:00:00Z");
    expect(remainingSeconds(ends, 0, client)).toBe(90);
    // the phone is 10 s behind the server: 10 s less to wait
    expect(remainingSeconds(ends, 10_000, client)).toBe(80);
    expect(remainingSeconds(ends, 0, client + 89_500)).toBe(1);
    expect(remainingSeconds(ends, 0, client + 95_000)).toBe(0);
    expect(remainingSeconds(null, 0, client)).toBe(0);
  });
});

describe("rest timer audio", () => {
  let restTimer: typeof import("./restTimer");
  let contexts: FakeAudioContext[];
  let fetchMock: ReturnType<typeof vi.fn>;
  let decodeMock: ReturnType<typeof vi.fn>;

  class FakeAudioContext {
    state = "suspended";
    currentTime = 10;
    destination = {};
    resume = vi.fn().mockResolvedValue(undefined);
    decodeAudioData = (...args: unknown[]) => decodeMock(...args);
    createBufferSource = vi.fn(() => ({
      connect: vi.fn(),
      start: vi.fn(),
    }));
    createGain = vi.fn(() => ({
      gain: { value: 0 },
      connect: vi.fn(),
    }));
    createOscillator = vi.fn(() => ({
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }));

    constructor() {
      contexts.push(this);
    }
  }

  beforeEach(async () => {
    vi.resetModules();
    contexts = [];
    decodeMock = vi.fn().mockResolvedValue({ duration: 1.6 });
    fetchMock = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      value: undefined,
    });
    restTimer = await import("./restTimer");
  });

  it("sets the audio session to ambient before constructing the context", () => {
    const order: string[] = [];
    Object.defineProperty(navigator, "audioSession", {
      configurable: true,
      value: {
        set type(value: string) {
          expect(value).toBe("ambient");
          order.push("ambient");
        },
      },
    });
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class extends FakeAudioContext {
        constructor() {
          order.push("context");
          super();
        }
      },
    });

    restTimer.unlockAudio();

    expect(order).toEqual(["ambient", "context"]);
  });

  it("does not throw when audioSession is unavailable", () => {
    expect(() => restTimer.unlockAudio()).not.toThrow();
  });

  it("does nothing when beep is called before audio is unlocked", () => {
    restTimer.beep();
    expect(contexts).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("plays the decoded bell sample when it is ready", async () => {
    restTimer.unlockAudio();
    await vi.waitFor(() => expect(decodeMock).toHaveBeenCalled());
    await Promise.resolve();

    restTimer.beep();

    expect(contexts[0].createBufferSource).toHaveBeenCalledOnce();
    expect(contexts[0].createBufferSource.mock.results[0].value.start).toHaveBeenCalledOnce();
    expect(contexts[0].createGain).toHaveBeenCalledOnce();
    expect(contexts[0].createOscillator).not.toHaveBeenCalled();
  });

  it("falls back to the two oscillators while the sample is unavailable", () => {
    decodeMock.mockReturnValue(new Promise(() => {}));
    restTimer.unlockAudio();

    restTimer.beep();

    expect(contexts[0].createOscillator).toHaveBeenCalledTimes(2);
    expect(contexts[0].createBufferSource).not.toHaveBeenCalled();
  });

  it("resumes interrupted audio on visibility and removes listeners on cleanup", () => {
    restTimer.unlockAudio();
    const context = contexts[0];
    context.resume.mockClear();
    context.state = "interrupted";
    const cleanup = restTimer.installAudioResume();

    document.dispatchEvent(new Event("visibilitychange"));
    expect(context.resume).toHaveBeenCalledOnce();
    context.resume.mockClear();
    window.dispatchEvent(new Event("pageshow"));
    expect(context.resume).toHaveBeenCalledOnce();

    cleanup();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    expect(context.resume).toHaveBeenCalledOnce();
  });
});
