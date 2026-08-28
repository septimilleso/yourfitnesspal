import { useEffect, useRef, useState } from "react";

/** Minimal shape of the (still-experimental, Chromium-only) native
 * `BarcodeDetector` API this component needs -- not in TS's lib.dom yet. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const DETECT_INTERVAL_MS = 400;

interface ScannerProps {
  onDetect: (code: string) => void;
  onClose: () => void;
}

/** Barcode scanner: uses the native `BarcodeDetector` API where the browser
 * supports it, falling back to a dynamically-imported `@zxing/browser`
 * decoder otherwise (older Firefox/Safari). Either path decodes frames from
 * the device camera and calls `onDetect` with the first barcode found. */
function Scanner({ onDetect, onClose }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let detectInterval: ReturnType<typeof setInterval> | undefined;
    let zxingControls: { stop: () => void } | null = null;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        // Best-effort video attach/autoplay -- deliberately isolated from
        // the outer try/catch (which drives the user-facing error state).
        // Some environments (jsdom in tests, certain browsers pre-permission)
        // throw or reject here; detection below doesn't depend on the video
        // element actually rendering frames in those cases.
        try {
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            const playResult = video.play();
            if (playResult && typeof (playResult as Promise<void>).catch === "function") {
              (playResult as Promise<void>).catch(() => {});
            }
          }
        } catch {
          // ignore -- non-fatal, detection can proceed without autoplay
        }

        if (typeof window !== "undefined" && window.BarcodeDetector) {
          const detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS });
          detectInterval = setInterval(() => {
            if (stopped || !videoRef.current) return;
            detector
              .detect(videoRef.current)
              .then((codes) => {
                if (codes.length > 0 && !stopped) {
                  onDetect(codes[0].rawValue);
                }
              })
              .catch(() => {
                // transient per-frame detection errors are expected; ignore
              });
          }, DETECT_INTERVAL_MS);
        } else {
          setUsingFallback(true);
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoDevice(
            undefined,
            videoRef.current ?? undefined,
            (result) => {
              if (result && !stopped) {
                onDetect(result.getText());
              }
            },
          );
        }
      } catch {
        if (!stopped) {
          setError("Impossibile accedere alla fotocamera.");
        }
      }
    }

    start();

    return () => {
      stopped = true;
      if (detectInterval) clearInterval(detectInterval);
      zxingControls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetect]);

  return (
    <div
      role="dialog"
      aria-label="Scanner codice a barre"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4"
      style={{ paddingTop: "calc(1rem + var(--safe-top))", paddingBottom: "calc(1rem + var(--safe-bottom))" }}
    >
      <p className="mb-3 text-center text-sm text-white/70">
        Inquadra il codice a barre del prodotto.
      </p>

      <div className="relative w-full max-w-sm">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          data-testid="scanner-video"
          muted
          playsInline
          className="w-full rounded-2xl bg-black"
        />
        {/* Corner brackets: without a target frame the camera view gives no
            hint about where to hold the barcode. */}
        <div aria-hidden className="pointer-events-none absolute inset-6 rounded-xl">
          <span className="absolute left-0 top-0 h-8 w-8 rounded-tl-xl border-l-2 border-t-2 border-white/80" />
          <span className="absolute right-0 top-0 h-8 w-8 rounded-tr-xl border-r-2 border-t-2 border-white/80" />
          <span className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-xl border-b-2 border-l-2 border-white/80" />
          <span className="absolute bottom-0 right-0 h-8 w-8 rounded-br-xl border-b-2 border-r-2 border-white/80" />
        </div>
      </div>

      {usingFallback && (
        <p className="mt-3 text-sm text-white/70">Modalità compatibilità attiva.</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={onClose}
        className="mt-5 w-full max-w-sm rounded-xl bg-white/95 py-3 text-[15px] font-semibold text-slate-900 active:bg-white/80"
      >
        Chiudi
      </button>
    </div>
  );
}

export default Scanner;
