import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Scanner from "./Scanner";

const decodeFromVideoDevice = vi.fn();
const zxingReaderStop = vi.fn();

vi.mock("@zxing/browser", () => ({
  // A plain `function` (not an arrow, and not `vi.fn().mockImplementation`)
  // -- Scanner.tsx calls this with `new`, which arrow functions can't
  // support and which `vi.fn()`-wrapped implementations warn about.
  BrowserMultiFormatReader: function BrowserMultiFormatReaderMock() {
    return {
      decodeFromVideoDevice: (...args: unknown[]) => decodeFromVideoDevice(...args),
    };
  },
}));

function mockGetUserMedia() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  return stream;
}

beforeEach(() => {
  mockGetUserMedia();
  // jsdom doesn't implement video.play(); stub it so the component's
  // best-effort call doesn't throw during tests.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  decodeFromVideoDevice.mockReset();
  decodeFromVideoDevice.mockResolvedValue({ stop: zxingReaderStop });
  zxingReaderStop.mockReset();
});

afterEach(() => {
  delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
  vi.restoreAllMocks();
});

describe("Scanner", () => {
  it("uses the native BarcodeDetector and reports a decoded code, without falling back to zxing", async () => {
    vi.useFakeTimers();
    const detect = vi.fn().mockResolvedValue([{ rawValue: "8001505005707" }]);
    (window as unknown as { BarcodeDetector: new () => { detect: typeof detect } }).BarcodeDetector =
      function BarcodeDetectorMock() {
        return { detect };
      } as unknown as new () => { detect: typeof detect };

    const onDetect = vi.fn();
    render(<Scanner onDetect={onDetect} onClose={vi.fn()} />);

    // Flush the async start() microtasks (getUserMedia resolution) while
    // advancing the fake detect-interval timer.
    await vi.advanceTimersByTimeAsync(500);

    expect(onDetect).toHaveBeenCalledWith("8001505005707");
    expect(decodeFromVideoDevice).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("falls back to the zxing dynamic import when BarcodeDetector is unavailable", async () => {
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    decodeFromVideoDevice.mockImplementation(
      async (_deviceId: unknown, _video: unknown, callback: (result: unknown) => void) => {
        callback({ getText: () => "5901234123457" });
        return { stop: zxingReaderStop };
      },
    );

    const onDetect = vi.fn();
    render(<Scanner onDetect={onDetect} onClose={vi.fn()} />);

    await vi.waitFor(() => expect(decodeFromVideoDevice).toHaveBeenCalled());
    expect(onDetect).toHaveBeenCalledWith("5901234123457");
  });
});
