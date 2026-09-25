import { Link, useLocation } from "react-router-dom";

import { useHasPermission } from "../auth/AuthContext";
import SettingsButton from "./SettingsButton";
import { type AppMode, currentMode, lastPath } from "../lib/appMode";
import { artIcon } from "../lib/art";

const MODES: { mode: AppMode; label: string }[] = [
  { mode: "diet", label: "Dieta" },
  { mode: "gym", label: "Palestra" },
];

/** Top row of each section's page headers: the segmented "Dieta | Palestra" control (only with the gym permission) and the settings gear. */
function ModeSwitch() {
  const canGym = useHasPermission("workouts.use");
  const { pathname, search } = useLocation();
  const mode = currentMode(pathname);
  return (
    <div className="relative mx-auto flex min-h-[48px] max-w-2xl items-center justify-center px-14 pt-2">
      {canGym && (
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
            </Link>
          ))}
        </div>
      )}
      <SettingsButton />
    </div>
  );
}

export default ModeSwitch;
