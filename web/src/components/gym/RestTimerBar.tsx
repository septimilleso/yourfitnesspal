import { useEffect, useMemo, useRef } from "react";

import type { Workout } from "../../api/gym";
import { formatDuration } from "../../lib/gym";
import { beep, clockOffsetMs, remainingSeconds, vibrate } from "../../lib/restTimer";
import { useNow } from "../../lib/useNow";

interface RestTimerBarProps {
  workout: Workout;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
}

const LATE_ALERT_MS = 5000;

/** Countdown under the workout header. Keep it mounted: it renders nothing
 * when no rest runs, but still has to notice the moment a rest reaches zero
 * to beep once per `rest_ends_at` when observed within five seconds. */
function RestTimerBar({ workout, onAdjust, onSkip }: RestTimerBarProps) {
  const now = useNow(250);
  const offset = useMemo(() => clockOffsetMs(workout.server_now, Date.now()), [workout.server_now]);
  const remaining = remainingSeconds(workout.rest_ends_at, offset, now);
  const seenRunning = useRef<string | null>(null);
  const fired = useRef<string | null>(null);

  useEffect(() => {
    const endsAt = workout.rest_ends_at;
    if (!endsAt) return;
    if (remaining > 0) {
      seenRunning.current = endsAt;
      return;
    }
    if (seenRunning.current === endsAt && fired.current !== endsAt) {
      fired.current = endsAt;
      const late = Date.now() + offset - Date.parse(endsAt);
      if (late <= LATE_ALERT_MS) {
        beep();
        vibrate();
      }
    }
  }, [offset, remaining, workout.rest_ends_at]);

  if (remaining <= 0) return null;
  const total = workout.rest_total_s ?? remaining;

  return (
    <div role="timer" aria-label="Riposo" className="border-t border-sky-100 bg-sky-50">
      <div className="h-1 bg-sky-100">
        <div
          className="h-1 bg-sky-500 transition-[width] duration-200"
          style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }}
        />
      </div>
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-2">
        <button type="button" className="btn-secondary min-h-[36px] px-3" onClick={() => onAdjust(-15)}>
          -15s
        </button>
        <span className="text-2xl font-semibold tabular-nums text-sky-700">{formatDuration(remaining)}</span>
        <button type="button" className="btn-secondary min-h-[36px] px-3" onClick={() => onAdjust(15)}>
          +15s
        </button>
        <button type="button" className="btn-ghost min-h-[36px] text-sky-700" onClick={onSkip}>
          Salta
        </button>
      </div>
    </div>
  );
}

export default RestTimerBar;
