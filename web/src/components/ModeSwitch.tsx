import { Link, useLocation } from "react-router-dom";

import { useHasPermission } from "../auth/AuthContext";
import { type AppMode, currentMode, lastPath } from "../lib/appMode";

const MODES: { mode: AppMode; label: string }[] = [
  { mode: "diet", label: "Dieta" },
  { mode: "gym", label: "Palestra" },
];

/** Segmented "Dieta | Palestra" control at the top of each section's page
 * headers. Switching goes back to the last page seen in that section.
 * Hidden for accounts without the gym permission. */
function ModeSwitch() {
  const canGym = useHasPermission("workouts.use");
  const { pathname, search } = useLocation();
  if (!canGym) return null;
  const mode = currentMode(pathname);
  return (
    <div className="mx-auto flex max-w-2xl justify-center px-4 pt-2">
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
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default ModeSwitch;
