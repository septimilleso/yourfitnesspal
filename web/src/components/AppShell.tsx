import { NavLink, Outlet } from "react-router-dom";

interface Tab {
  to: string;
  label: string;
  end?: boolean;
}

const TABS: Tab[] = [
  { to: "/", label: "Giorno", end: true },
  { to: "/search", label: "Cerca" },
  { to: "/week", label: "Settimana" },
  { to: "/settings", label: "Impostazioni" },
];

/** Persistent app shell for every authenticated route: renders the current
 * page via `<Outlet>` plus a bottom navigation bar with a tab per top-level
 * page. Without this, `/week` (the bulk-copy feature) and `/settings` are
 * only reachable by typing the URL directly -- unreachable in the installed
 * PWA, which has no address bar (CRITICAL 3 of the final review). Lives
 * inside `<AuthGuard>`'s route in `App.tsx` so it appears on every
 * protected page, including `/search` (reached today via "+ Aggiungi"). */
function AppShell() {
  return (
    <div className="min-h-screen pb-16">
      <Outlet />
      <nav
        aria-label="Navigazione principale"
        className="fixed inset-x-0 bottom-0 flex border-t border-slate-200 bg-white"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex min-h-[44px] flex-1 flex-col items-center justify-center py-2 text-xs font-medium ${
                isActive ? "text-slate-900" : "text-slate-400"
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default AppShell;
