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
  const overGoal = remaining !== null && remaining < 0;

  return (
    <div className="relative flex h-40 w-40 shrink-0 items-center justify-center">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={RING_RADIUS} fill="none" stroke="#e2e8f0" strokeWidth="11" />
        {goalKcal !== null && (
          <circle
            cx="60"
            cy="60"
            r={RING_RADIUS}
            fill="none"
            /* Red once the ring is full and the goal is blown -- the ring
               itself caps at 100%, so colour is the only over-goal signal. */
            stroke={overGoal ? "#dc2626" : "#059669"}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-500"
          />
        )}
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">
          {Math.round(consumed)}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">kcal</span>
        {remaining !== null && (
          <span
            className={`mt-1 text-xs font-semibold ${overGoal ? "text-red-600" : "text-slate-500"}`}
          >
            {overGoal
              ? `${Math.abs(remaining)} kcal oltre`
              : `${remaining} kcal rimanenti`}
          </span>
        )}
      </div>
    </div>
  );
}

interface MacroBarProps {
  label: string;
  consumed: number;
  goal: number | null;
  /** Track fill colour -- one per macro, so the three bars are tellable
   * apart at a glance instead of being three identical dark bars. */
  color: string;
}

function MacroBar({ label, consumed, goal, color }: MacroBarProps) {
  const ratio = goal && goal > 0 ? consumed / goal : 0;
  const pct = Math.min(ratio * 100, 100);
  const overGoal = ratio > 1;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium text-slate-700">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className={`tabular-nums ${overGoal ? "font-semibold text-red-600" : "text-slate-500"}`}>
          {Math.round(consumed)}
          {goal !== null ? ` / ${Math.round(goal)}` : ""} g
        </span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: overGoal ? "#dc2626" : color }}
        />
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
 * been set yet -- the bars/ring then just show consumed amounts, and a hint
 * points at Impostazioni, since an unexplained empty ring reads as a bug). */
function DaySummary({ total, goal }: DaySummaryProps) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col items-center gap-5 p-5 sm:flex-row sm:justify-around">
        <CalorieRing consumed={total.kcal} goalKcal={goal ? goal.kcal : null} />
        {/* Vertical hairline between ring and macros on wide screens; the
            stacked mobile layout gets the horizontal one below instead. */}
        <div className="hidden self-stretch border-l border-slate-100 sm:block" />
        <div className="w-full max-w-xs space-y-3.5">
          <MacroBar
            label="Proteine"
            consumed={total.protein_g}
            goal={goal ? goal.protein_g : null}
            color="#3b82f6"
          />
          <MacroBar
            label="Carboidrati"
            consumed={total.carbs_g}
            goal={goal ? goal.carbs_g : null}
            color="#f59e0b"
          />
          <MacroBar
            label="Grassi"
            consumed={total.fat_g}
            goal={goal ? goal.fat_g : null}
            color="#a855f7"
          />
        </div>
      </div>

      {goal === null && (
        <p className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-center text-xs text-slate-500">
          Nessun obiettivo impostato — impostalo in <span className="font-medium">Impostazioni</span>{" "}
          per vedere quanto ti resta.
        </p>
      )}
    </section>
  );
}

export default DaySummary;
