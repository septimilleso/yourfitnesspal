import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useHasPermission } from "../auth/AuthContext";
import { currentMode, rememberPath } from "../lib/appMode";
import { artIcon, pattern, type DietIcon, type GymIcon } from "../lib/art";
import ActiveWorkoutBar from "./gym/ActiveWorkoutBar";

interface Tab {
  to: string;
  label: string;
  icon: DietIcon | GymIcon;
  end?: boolean;
}

const SETTINGS_TAB: Tab = {
  to: "/settings",
  label: "Impostazioni",
  icon: "gear",
};

const DIET_TABS: Tab[] = [
  { to: "/", label: "Giorno", end: true, icon: "plate" },
  { to: "/search", label: "Cerca", icon: "basket" },
  { to: "/week", label: "Settimana", icon: "chart" },
  SETTINGS_TAB,
];

const GYM_TABS: Tab[] = [
  { to: "/gym/history", label: "Storico", icon: "calendar" },
  { to: "/gym", label: "Inizia", end: true, icon: "dumbbell" },
  { to: "/gym/exercises", label: "Esercizi", icon: "book" },
  SETTINGS_TAB,
];

/** Persistent app shell for every authenticated route: renders the current
 * page via `<Outlet>` plus a bottom navigation bar. The bar shows the diet
 * tabs or the gym tabs depending on the section (see lib/appMode.ts); shared
 * pages such as settings keep the last section's tabs.
 *
 * iOS layout notes: the bar is translucent + blurred (content scrolls
 * visibly under it, as in a native tab bar) and pads itself by
 * `env(safe-area-inset-bottom)`, so on a gesture-navigation iPhone the
 * labels sit ABOVE the home indicator instead of underneath it. Page
 * content is padded by the resulting total height (`--nav-height`, see
 * index.css) so the last row of any page is never hidden by the bar. */
function AppShell() {
  const { pathname, search } = useLocation();
  const canGym = useHasPermission("workouts.use");

  useEffect(() => {
    rememberPath(pathname, search);
  }, [pathname, search]);

  const mode = currentMode(pathname);
  const tabs = canGym && mode === "gym" ? GYM_TABS : DIET_TABS;

  return (
    <div className="relative isolate min-h-screen bg-app pb-[calc(var(--nav-height)+0.5rem)]">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: `url("${pattern(mode)}")` }}
      />
      <div className="relative z-10">
        <Outlet />
      </div>
      {canGym && <ActiveWorkoutBar />}
      <nav
        aria-label="Navigazione principale"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200/80 bg-app/85 backdrop-blur-xl pb-[var(--safe-bottom)]"
      >
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex h-[var(--nav-content-height)] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                isActive ? "text-brand-600" : "text-slate-400"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <img
                  src={artIcon(mode, tab.icon)}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className={`h-7 w-7 transition-transform ${
                    isActive ? "scale-110" : "grayscale opacity-60"
                  }`}
                />
                <span className={isActive ? "text-brand-700" : ""}>{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default AppShell;
