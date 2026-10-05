import { useState } from "react";

import type { Meal } from "../api/queries";
import { MEALS } from "../api/queries";
import { useApplySavedWeek } from "../api/savedWeeks";
import CopyOptionsFields from "./CopyOptionsFields";

interface ApplySavedWeekDialogProps {
  savedWeekId: number;
  days: number[] | null;
  onClose: () => void;
}

function ApplySavedWeekDialog({
  savedWeekId,
  days,
  onClose,
}: ApplySavedWeekDialogProps) {
  const [targetStart, setTargetStart] = useState("");
  const [selectedMeals, setSelectedMeals] = useState<Meal[]>(MEALS);
  const [mode, setMode] = useState<"append" | "replace">("append");

  const applySavedWeek = useApplySavedWeek();

  function toggleMeal(meal: Meal) {
    setSelectedMeals((prev) =>
      prev.includes(meal) ? prev.filter((m) => m !== meal) : [...prev, meal],
    );
  }

  function handleClose() {
    applySavedWeek.reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetStart || selectedMeals.length === 0 || applySavedWeek.isPending) return;
    applySavedWeek.mutate({
      id: savedWeekId,
      days,
      target_start: targetStart,
      meals: selectedMeals.length === MEALS.length ? null : selectedMeals,
      mode,
    });
  }

  const canSubmit =
    targetStart.length > 0 && selectedMeals.length > 0 && !applySavedWeek.isPending;
  const title =
    days === null
      ? "Applica settimana"
      : `Applica ${days.length} ${days.length === 1 ? "giorno" : "giorni"}`;

  return (
    <div
      role="dialog"
      aria-label="Applica settimana"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet">
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="border-b border-slate-100 px-5 pb-3 pt-3">
          <h2 className="text-[17px] font-semibold text-slate-900">{title}</h2>
        </div>

        {applySavedWeek.isSuccess && applySavedWeek.data ? (
          <>
            <p role="status" className="px-5 py-6 text-center text-sm text-slate-700">
              Applicati {applySavedWeek.data.entries_created}{" "}
              {applySavedWeek.data.entries_created === 1 ? "pasto" : "pasti"} in{" "}
              {applySavedWeek.data.days.length} {applySavedWeek.data.days.length === 1 ? "giorno" : "giorni"}.
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
              <CopyOptionsFields
                targetStart={targetStart}
                onTargetStartChange={setTargetStart}
                selectedMeals={selectedMeals}
                onToggleMeal={toggleMeal}
                mode={mode}
                onModeChange={setMode}
              />

              {applySavedWeek.isError && (
                <p role="alert" className="text-sm text-red-600">
                  Errore durante l'applicazione della settimana.
                </p>
              )}
            </div>

            <div className="flex gap-2 border-t border-slate-100 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
              <button type="button" onClick={handleClose} className="btn-secondary flex-1">
                Annulla
              </button>
              <button type="submit" disabled={!canSubmit} className="btn-primary flex-1">
                Applica
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ApplySavedWeekDialog;
