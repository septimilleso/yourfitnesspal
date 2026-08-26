import type { Goal, Nutriments } from "../api/queries";

interface CalorieRingProps {
  consumed: number;
  goalKcal: number | null;
}

const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function CalorieRing({ consumed, goalKcal }: CalorieRingProps) {
  const pct = goalKcal && goalKcal > 0 ? Math.min(consumed / goalKcal, 1) : 0;
  const offset = RING_CIRCUMFERENCE * (1 - pct);
  const remaining = goalKcal !== null ? Math.round(goalKcal - consumed) : null;

  return (
    <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        {goalKcal !== null && (
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            stroke="#0f172a"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={offset}
          />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold text-slate-900">{Math.round(consumed)}</span>
        <span className="text-xs text-slate-500">
          {remaining !== null ? `${Math.max(remaining, 0)} kcal rimanenti` : "kcal"}
        </span>
      </div>
    </div>
  );
}

interface MacroBarProps {
  label: string;
  consumed: number;
  goal: number | null;
}

function MacroBar({ label, consumed, goal }: MacroBarProps) {
  const pct = goal && goal > 0 ? Math.min((consumed / goal) * 100, 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>
          {Math.round(consumed)}g{goal !== null ? ` / ${Math.round(goal)}g` : ""}
        </span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-slate-900" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface DaySummaryProps {
  total: Nutriments;
  goal: Goal | null;
}

/** Calorie-remaining ring + protein/carbs/fat progress bars for a day's
 * totals vs. the currently active goal (goal may be `null` if none has
 * been set yet -- the bars/ring then just show consumed amounts). */
function DaySummary({ total, goal }: DaySummaryProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg bg-white p-4 shadow-sm sm:flex-row sm:justify-around">
      <CalorieRing consumed={total.kcal} goalKcal={goal ? goal.kcal : null} />
      <div className="w-full max-w-xs space-y-3">
        <MacroBar label="Proteine" consumed={total.protein_g} goal={goal ? goal.protein_g : null} />
        <MacroBar label="Carboidrati" consumed={total.carbs_g} goal={goal ? goal.carbs_g : null} />
        <MacroBar label="Grassi" consumed={total.fat_g} goal={goal ? goal.fat_g : null} />
      </div>
    </div>
  );
}

export default DaySummary;
