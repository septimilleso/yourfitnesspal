import { PRESETS, type PeriodChoice, type Preset } from "../../lib/stats";

interface Props {
  choice: PeriodChoice;
  today: string;
  error: string | null;
  onPreset: (days: Preset) => void;
  onCustom: () => void;
  onDates: (from: string, to: string) => void;
}

const BUTTON = "flex-1 rounded-md px-2 py-1.5 text-[13px] font-semibold transition";

/** 7 / 30 / 90 days or a custom from–to range. */
function PeriodPicker({ choice, today, error, onPreset, onCustom, onDates }: Props) {
  const active = (on: boolean) => (on ? "bg-white text-slate-900 shadow-sm" : "text-slate-500");
  return (
    <section className="card space-y-3 px-4 py-3">
      <div role="group" aria-label="Periodo" className="flex rounded-lg bg-slate-200/70 p-0.5">
        {PRESETS.map((days) => {
          const on = choice.kind === "preset" && choice.days === days;
          return (
            <button
              key={days}
              type="button"
              aria-pressed={on}
              onClick={() => onPreset(days)}
              className={`${BUTTON} ${active(on)}`}
            >
              {days} giorni
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={choice.kind === "custom"}
          onClick={onCustom}
          className={`${BUTTON} ${active(choice.kind === "custom")}`}
        >
          Personalizzato
        </button>
      </div>
      {choice.kind === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Dal</span>
            <input
              type="date"
              value={choice.from}
              max={today}
              onChange={(e) => onDates(e.target.value, choice.to)}
              className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 py-2 text-base"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Al</span>
            <input
              type="date"
              value={choice.to}
              max={today}
              onChange={(e) => onDates(choice.from, e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-slate-300 px-3 py-2 text-base"
            />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}

export default PeriodPicker;
