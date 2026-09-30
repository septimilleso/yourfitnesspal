/** Rest-timer helpers. The countdown is derived from the absolute
 * `rest_ends_at` the server stores, corrected by the offset between the
 * server clock and the phone clock, so it stays right after the screen
 * sleeps or the page reloads. */

export function clockOffsetMs(serverNowIso: string, clientNowMs: number): number {
  return Date.parse(serverNowIso) - clientNowMs;
}

export function remainingSeconds(
  restEndsAtIso: string | null,
  offsetMs: number,
  clientNowMs: number,
): number {
  if (!restEndsAtIso) return 0;
  const ms = Date.parse(restEndsAtIso) - (clientNowMs + offsetMs);
  return ms <= 0 ? 0 : Math.ceil(ms / 1000);
}

type AudioContextCtor = typeof AudioContext;
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

let audioContext: AudioContext | null = null;
let bellBuffer: AudioBuffer | null = null;
let bellLoadStarted = false;

function loadBellSample(context: AudioContext): void {
  if (bellLoadStarted) return;
  bellLoadStarted = true;
  void fetch("/sounds/rest-bell.wav")
    .then((response) => response.arrayBuffer())
    .then((data) => context.decodeAudioData(data))
    .then((buffer) => {
      bellBuffer = buffer;
    })
    .catch(() => {
      // Fall back to the synthesized beeps if loading or decoding fails.
    });
}

/** iOS only plays WebAudio after a user gesture: call this from a tap. */
export function unlockAudio(): void {
  try {
    const audioSession = (navigator as AudioSessionNavigator).audioSession;
    if (audioSession) audioSession.type = "ambient";

    const Ctor: AudioContextCtor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    loadBellSample(audioContext);
    if (audioContext.state === "suspended") void audioContext.resume();
  } catch {
    // Audio is a nicety; the visual countdown still works.
  }
}

export function resumeAudio(): void {
  if (!audioContext || audioContext.state === "running") return;
  try {
    void audioContext.resume().catch(() => {});
  } catch {
    // Audio is a nicety; the visual countdown still works.
  }
}

export function installAudioResume(): () => void {
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") resumeAudio();
  };
  const onPageShow = (): void => resumeAudio();
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pageshow", onPageShow);
  };
}

/** Play the decoded bell sample, falling back to two short beeps. Silent if audio was never unlocked. */
export function beep(): void {
  resumeAudio();
  if (!audioContext) return;
  try {
    if (bellBuffer) {
      const source = audioContext.createBufferSource();
      const gain = audioContext.createGain();
      source.buffer = bellBuffer;
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(audioContext.destination);
      source.start(audioContext.currentTime);
      return;
    }

    for (const offset of [0, 0.3]) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.2;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      const start = audioContext.currentTime + offset;
      oscillator.start(start);
      oscillator.stop(start + 0.18);
    }
  } catch {
    // ignore
  }
}

export function vibrate(): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([200, 100, 200]);
  }
}
