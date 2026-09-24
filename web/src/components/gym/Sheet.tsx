import type { ReactNode } from "react";

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Nearly full height (pickers, long lists). */
  full?: boolean;
  headerAction?: ReactNode;
}

/** Bottom sheet on phones, centred dialog from `sm:` up -- the same overlay,
 * grabber and safe-area footer as `EditEntrySheet`. */
function Sheet({ title, onClose, children, footer, full = false, headerAction }: SheetProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`flex w-full max-w-lg flex-col overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet ${
          full ? "h-[92vh]" : "max-h-[85vh]"
        }`}
      >
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 pb-2 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Chiudi
          </button>
          <h2 className="truncate text-[17px] font-semibold text-slate-900">{title}</h2>
          <div className="flex min-w-[4.5rem] justify-end">{headerAction}</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <div className="border-t border-slate-100 px-4 pb-[calc(0.75rem+var(--safe-bottom))] pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export default Sheet;
