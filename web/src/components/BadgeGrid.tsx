import { useState } from "react";

import type { AppMode } from "../lib/appMode";
import {
  badgeProgress,
  BADGE_COUNT,
  DAYS_PER_BADGE,
  gymBadgeProgress,
  WORKOUTS_PER_BADGE,
} from "../lib/badges";
import { badgeIcon } from "../lib/art";

/** One badge is earned every five streak days or ten finished workouts. */
function BadgeGrid({
  mode,
  current,
  unit = "streak",
}: {
  mode: AppMode;
  current: number;
  unit?: "streak" | "workouts";
}) {
  const { earned, nextIn } = unit === "workouts" ? gymBadgeProgress(current) : badgeProgress(current);
  const [expanded, setExpanded] = useState(false);

  const nextLabel = unit === "workouts" ? "allenamento" : "giorno";
  const firstBadgeLabel = unit === "workouts"
    ? `Primo badge a ${WORKOUTS_PER_BADGE} allenamenti`
    : `Primo badge a ${DAYS_PER_BADGE} giorni di fila`;
  const lockedBadgeLabel = (n: number) => unit === "workouts"
    ? `${n * WORKOUTS_PER_BADGE} all.`
    : `${n * DAYS_PER_BADGE} gg`;

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-slate-700">Badge {earned} / {BADGE_COUNT}</p>
        <p className="text-xs text-slate-500">
          {nextIn === null
            ? "Collezione completa!"
            : `Prossimo badge tra ${nextIn} ${nextIn === 1 ? nextLabel : unit === "workouts" ? "allenamenti" : "giorni"}`}
        </p>
      </div>
      {!expanded && (
        <div className="flex items-center gap-3">
          <img
            src={badgeIcon(mode, earned || 1)}
            alt={earned >= 1 ? `Badge ${earned}` : "Badge 1 bloccato"}
            draggable={false}
            className={`h-16 w-16 rounded-xl ${earned >= 1 ? "" : "grayscale opacity-30"}`}
          />
          <span className="text-sm text-slate-600">
            {earned >= 1 ? "Ultimo badge sbloccato" : firstBadgeLabel}
          </span>
        </div>
      )}
      <ul id="badge-grid" hidden={!expanded} className="grid grid-cols-5 gap-2">
        {expanded && Array.from({ length: BADGE_COUNT }, (_, index) => index + 1).map((n) => {
          const unlocked = n <= earned;
          return (
            <li key={n} className="flex flex-col items-center gap-0.5">
              <img
                src={badgeIcon(mode, n)}
                alt={unlocked ? `Badge ${n}` : `Badge ${n} bloccato`}
                draggable={false}
                loading="lazy"
                className={`aspect-square w-full max-w-[64px] rounded-xl ${unlocked ? "" : "grayscale opacity-30"} ${n === earned ? "ring-2 ring-brand-500 ring-offset-1" : ""}`}
              />
              {!unlocked && <span className="text-[10px] tabular-nums text-slate-400">{lockedBadgeLabel(n)}</span>}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="badge-grid"
        onClick={() => setExpanded((value) => !value)}
        className="min-h-[44px] w-full text-sm font-medium text-brand-700"
      >
        {expanded ? "Nascondi badge" : "Mostra tutti i badge"}
      </button>
    </div>
  );
}

export default BadgeGrid;
