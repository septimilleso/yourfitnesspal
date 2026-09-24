import { type ReactNode, useState } from "react";

export interface Action {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

interface ActionMenuProps {
  /** Accessible name of the trigger button. */
  label: string;
  actions: Action[];
  /** Custom trigger content; defaults to "•••". */
  trigger?: ReactNode;
  triggerClassName?: string;
}

/** The "•••" menu used on cards, exercises and sets. */
function ActionMenu({ label, actions, trigger, triggerClassName }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={
          triggerClassName ??
          "rounded-lg bg-sky-50 px-2.5 py-1 text-sm font-bold tracking-widest text-sky-600 active:bg-sky-100"
        }
      >
        {trigger ?? "•••"}
      </button>
      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <ul
            role="menu"
            className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-card"
          >
            {actions.map((action) => (
              <li key={action.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  className={`block w-full px-4 py-2.5 text-left text-[15px] active:bg-slate-100 ${
                    action.destructive ? "text-red-600" : "text-slate-800"
                  }`}
                >
                  {action.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default ActionMenu;
