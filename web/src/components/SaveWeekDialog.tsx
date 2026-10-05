import { useState } from "react";

import { ApiError } from "../api/client";
import { useSaveWeek } from "../api/savedWeeks";

interface SaveWeekDialogProps {
  start: string;
  onClose: () => void;
  onSaved?: () => void;
}

function SaveWeekDialog({ start, onClose, onSaved }: SaveWeekDialogProps) {
  const [name, setName] = useState("");
  const saveWeek = useSaveWeek();

  function handleClose() {
    saveWeek.reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || saveWeek.isPending) return;
    saveWeek.mutate(
      { name: trimmedName, start },
      { onSuccess: () => onSaved?.() },
    );
  }

  const canSubmit = name.trim().length > 0 && !saveWeek.isPending;
  const errorMessage =
    saveWeek.error instanceof ApiError
      ? saveWeek.error.message
      : "Errore durante il salvataggio della settimana.";

  return (
    <div
      role="dialog"
      aria-label="Salva settimana"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet">
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="border-b border-slate-100 px-5 pb-3 pt-3">
          <h2 className="text-[17px] font-semibold text-slate-900">Salva settimana</h2>
        </div>

        {saveWeek.isSuccess ? (
          <>
            <p role="status" className="px-5 py-6 text-center text-sm text-slate-700">
              Settimana salvata.
            </p>
            <div className="border-t border-slate-100 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
              <button type="button" onClick={handleClose} className="btn-primary w-full">
                Chiudi
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="space-y-5 px-5 py-4">
              <div>
                <label htmlFor="save-week-name" className="field-label">
                  Nome
                </label>
                <input
                  id="save-week-name"
                  type="text"
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="field mt-1.5"
                />
              </div>

              {saveWeek.isError && (
                <p role="alert" className="text-sm text-red-600">
                  {errorMessage}
                </p>
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-100 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
              <button type="button" onClick={handleClose} className="btn-secondary flex-1">
                Annulla
              </button>
              <button type="submit" disabled={!canSubmit} className="btn-primary flex-1">
                Salva
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default SaveWeekDialog;
