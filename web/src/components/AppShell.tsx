import { type ReactNode, useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { useHasPermission } from "../auth/AuthContext";
import { currentMode, rememberPath } from "../lib/appMode";
import ActiveWorkoutBar from "./gym/ActiveWorkoutBar";

interface Tab {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

/** Tab icons: 24px stroked line icons (Apple's tab bars are icon-first,
 * label-second -- a bar of four bare words is hard to scan and gives no
 * anchor for muscle memory). `currentColor` so the active/inactive tint is
 * driven entirely by the link's text colour. */
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-6 w-6",
  "aria-hidden": true,
};

const SETTINGS_TAB: Tab = {
  to: "/settings",
  label: "Impostazioni",
  icon: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  ),
};

const DIET_TABS: Tab[] = [
  {
    to: "/",
    label: "Giorno",
    end: true,
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    to: "/search",
    label: "Cerca",
    icon: (
      <svg {...iconProps}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    ),
  },
  {
    to: "/week",
    label: "Settimana",
    icon: (
      <svg {...iconProps}>
        <path d="M4 19V9M10 19V5M16 19v-7M4 19h16" />
      </svg>
    ),
  },
  SETTINGS_TAB,
];

const GYM_TABS: Tab[] = [
  {
    to: "/gym/history",
    label: "Storico",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    to: "/gym",
    label: "Inizia",
    end: true,
    icon: (
      <svg {...iconProps}>
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    to: "/gym/exercises",
    label: "Esercizi",
    icon: (
      <svg {...iconProps}>
        <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
      </svg>
    ),
  },
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

  const tabs = canGym && currentMode(pathname) === "gym" ? GYM_TABS : DIET_TABS;

  return (
    <div className="min-h-screen bg-app pb-[calc(var(--nav-height)+0.5rem)]">
      <Outlet />
      {canGym && <ActiveWorkoutBar />}
      <nav
        aria-label="Navigazione principale"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200/80 bg-white/85 backdrop-blur-xl pb-[var(--safe-bottom)]"
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
            {tab.icon}
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default AppShell;
