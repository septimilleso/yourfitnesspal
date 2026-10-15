import { useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";

import { useHasPermission } from "../auth/AuthContext";
import OfflineIndicator from "./OfflineIndicator";
import SettingsButton from "./SettingsButton";
import WeightButton from "./WeightButton";
import { type AppMode, currentMode, lastPath } from "../lib/appMode";
import { artIcon } from "../lib/art";
import { getSnapshot, subscribe, syncBadgeCount } from "../native/gymStore";
import { isNative } from "../native/platform";

const MODES: { mode: AppMode; label: string }[] = [
  { mode: "diet", label: "Dieta" },
  { mode: "gym", label: "Palestra" },
];

/** Top row of each section's page headers: the weight button, segmented "Dieta | Palestra" control (only with the gym permission), and settings gear. */
function ModeSwitch() {
  const canGym = useHasPermission("workouts.use");
  const { pathname, search } = useLocation();
  const mode = currentMode(pathname);
  const store = useSyncExternalStore(subscribe, getSnapshot);
  // Solo nell'IPA: nel browser lo store è vuoto (R23).
  const unsynced = isNative() ? syncBadgeCount(store) : 0;
  if (!canGym && pathname === "/settings") return null;
  return (
    <div className="relative mx-auto flex min-h-[48px] max-w-2xl items-center justify-center px-14 pt-2">
      <WeightButton />
      {canGym ? (
        <div className="flex items-center gap-1">
          <div role="group" aria-label="Sezione" className="inline-flex rounded-lg bg-slate-200/70 p-0.5">
            {MODES.map((item) => (
              <Link
                key={item.mode}
                to={item.mode === mode ? pathname + search : lastPath(item.mode)}
                aria-current={item.mode === mode ? "page" : undefined}
                className={`rounded-md px-5 py-1 text-[13px] font-semibold transition ${
                  item.mode === mode ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                <img
                  src={artIcon(item.mode, "cat")}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="mr-1 inline-block h-5 w-5 align-middle"
                />
                {item.label}
                {item.mode === "gym" && unsynced > 0 && (
                  <span
                    role="img"
                    aria-label={unsynced === 1 ? "1 allenamento da sincronizzare" : `${unsynced} allenamenti da sincronizzare`}
                    className="ml-1 inline-flex min-w-[1.25rem] justify-center rounded-full bg-amber-500 px-1 text-[11px] font-bold leading-5 text-white"
                  >
                    {unsynced}
                  </span>
                )}
              </Link>
            ))}
          </div>
          {/* Margine negativo: il pulsante da 44 px non allunga la riga (min-h 48 con pt-2). */}
          <OfflineIndicator className="relative -my-1 inline-flex shrink-0" />
        </div>
      ) : (
        <OfflineIndicator className="relative -my-1 inline-flex shrink-0" />
      )}
      <SettingsButton />
    </div>
  );
}

export default ModeSwitch;
