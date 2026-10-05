import type { Meal } from "../api/queries";
import { MEALS } from "../api/queries";
import { MEAL_LABELS } from "../lib/meals";

interface CopyOptionsFieldsProps {
  targetStart: string;
  onTargetStartChange: (value: string) => void;
  selectedMeals: Meal[];
  onToggleMeal: (meal: Meal) => void;
  mode: "append" | "replace";
  onModeChange: (mode: "append" | "replace") => void;
}

function CopyOptionsFields({
  targetStart,
  onTargetStartChange,
  selectedMeals,
  onToggleMeal,
  mode,
  onModeChange,
}: CopyOptionsFieldsProps) {
  return (
    <>
      <div>
        <label htmlFor="copy-target-start" className="field-label">
          Data di inizio
        </label>
        <input
          id="copy-target-start"
          type="date"
          value={targetStart}
          onChange={(e) => onTargetStartChange(e.target.value)}
          className="field mt-1.5"
        />
      </div>

      <fieldset>
        <legend className="field-label">Pasti</legend>
        {/* Checkbox rows in a bordered group with hairlines between
            them -- inline checkboxes on one line were impossible to
            hit accurately on a phone. */}
        <div className="mt-1.5 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {MEALS.map((meal) => (
            <label
              key={meal}
              className="flex min-h-[44px] items-center gap-3 px-3 text-[15px] text-slate-700"
            >
              <input
                type="checkbox"
                checked={selectedMeals.includes(meal)}
                onChange={() => onToggleMeal(meal)}
                aria-label={MEAL_LABELS[meal]}
              />
              {MEAL_LABELS[meal]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="field-label">Modalità</legend>
        <div className="mt-1.5 space-y-2">
          {/* "Sostituisci" wipes the target days' existing entries,
              so it says so instead of relying on the verb alone. */}
          <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-200 px-3 text-[15px] text-slate-700">
            <input
              type="radio"
              name="copy-mode"
              checked={mode === "append"}
              onChange={() => onModeChange("append")}
            />
            <span>
              Aggiungi
              <span className="block text-[12px] text-slate-500">
                Mantiene i pasti già presenti
              </span>
            </span>
          </label>
          <label className="flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-200 px-3 text-[15px] text-slate-700">
            <input
              type="radio"
              name="copy-mode"
              checked={mode === "replace"}
              onChange={() => onModeChange("replace")}
            />
            <span>
              Sostituisci
              <span className="block text-[12px] text-slate-500">
                Cancella i pasti già presenti
              </span>
            </span>
          </label>
        </div>
      </fieldset>
    </>
  );
}

export default CopyOptionsFields;
