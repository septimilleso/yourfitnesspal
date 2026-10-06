import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

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
  const [placement, setPlacement] = useState<{
    vertical: "bottom" | "top";
    align: "right" | "left";
  }>({ vertical: "bottom", align: "right" });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement((current) =>
        current.vertical === "bottom" && current.align === "right"
          ? current
          : { vertical: "bottom", align: "right" },
      );
      return;
    }

    const wrapper = wrapperRef.current;
    const menu = menuRef.current;
    if (!wrapper || !menu) return;

    const triggerRect = wrapper.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="Navigazione principale"]');
    const navTop = nav?.getBoundingClientRect().top;
    const lowerLimit = navTop !== undefined && navTop > 0 && navTop <= window.innerHeight
      ? navTop
      : window.innerHeight;
    const spaceBelow = lowerLimit - triggerRect.bottom - 8;
    const spaceAbove = triggerRect.top - 8;
    const nextPlacement = {
      vertical: spaceBelow < menuRect.height && spaceAbove > spaceBelow ? "top" : "bottom",
      align: triggerRect.right - menuRect.width >= 8 ? "right" : "left",
    } as const;

    setPlacement((current) =>
      current.vertical === nextPlacement.vertical && current.align === nextPlacement.align
        ? current
        : nextPlacement,
    );
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
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
            ref={menuRef}
            role="menu"
            data-placement={placement.vertical}
            data-align={placement.align}
            className={`absolute z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-card ${
              placement.vertical === "top" ? "bottom-full mb-1" : "mt-1"
            } ${placement.align === "left" ? "left-0" : "right-0"}`}
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
