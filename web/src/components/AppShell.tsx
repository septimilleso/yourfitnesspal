import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";

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

const TABS: Tab[] = [
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
  {
    to: "/settings",
    label: "Impostazioni",
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
      </svg>
    ),
  },
];

/** Persistent app shell for every authenticated route: renders the current
 * page via `<Outlet>` plus a bottom navigation bar with a tab per top-level
 * page. Without this, `/week` (the bulk-copy feature) and `/settings` are
 * only reachable by typing the URL directly -- unreachable in the installed
 * PWA, which has no address bar (CRITICAL 3 of the final review). Lives
 * inside `<AuthGuard>`'s route in `App.tsx` so it appears on every
 * protected page, including `/search` (reached today via "+ Aggiungi").
 *
 * iOS layout notes: the bar is translucent + blurred (content scrolls
 * visibly under it, as in a native tab bar) and pads itself by
 * `env(safe-area-inset-bottom)`, so on a gesture-navigation iPhone the
 * labels sit ABOVE the home indicator instead of underneath it. Page
 * content is padded by the resulting total height (`--nav-height`, see
 * index.css) so the last row of any page is never hidden by the bar. */
function AppShell() {
  return (
    <div className="min-h-screen bg-app pb-[calc(var(--nav-height)+0.5rem)]">
      <Outlet />
      <nav
        aria-label="Navigazione principale"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200/80 bg-white/85 backdrop-blur-xl pb-[var(--safe-bottom)]"
      >
        {TABS.map((tab) => (
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
