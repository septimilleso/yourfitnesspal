import type { AppMode } from "../lib/appMode";
import { badgeProgress, BADGE_COUNT, DAYS_PER_BADGE } from "../lib/badges";
import { badgeIcon } from "../lib/art";

/** One badge is earned every five days of the current streak. */
function BadgeGrid({ mode, current }: { mode: AppMode; current: number }) {
  const { earned, nextIn } = badgeProgress(current);

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-slate-700">Badge {earned} / {BADGE_COUNT}</p>
        <p className="text-xs text-slate-500">
          {nextIn === null
            ? "Collezione completa!"
            : `Prossimo badge tra ${nextIn} ${nextIn === 1 ? "giorno" : "giorni"}`}
        </p>
      </div>
      <ul className="grid grid-cols-5 gap-2">
        {Array.from({ length: BADGE_COUNT }, (_, index) => index + 1).map((n) => {
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
              {!unlocked && <span className="text-[10px] tabular-nums text-slate-400">{n * DAYS_PER_BADGE} gg</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default BadgeGrid;
