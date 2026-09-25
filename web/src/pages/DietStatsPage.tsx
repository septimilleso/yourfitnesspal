import { useSearchParams } from "react-router-dom";

import { useDiaryRange, useGoal } from "../api/queries";
import GoalForm from "../components/GoalForm";
import ModeSwitch from "../components/ModeSwitch";
import StreakCard from "../components/StreakCard";
import KcalChart from "../components/stats/KcalChart";
import MacroChart from "../components/stats/MacroChart";
import MacroSplitBars from "../components/stats/MacroSplitBars";
import PeriodPicker, { type PeriodChoice } from "../components/stats/PeriodPicker";
import SummaryTable from "../components/stats/SummaryTable";
import { todayIso } from "../lib/date";
import {
  chartPoints,
  macroSplit,
  type Period,
  type Preset,
  PRESETS,
  presetPeriod,
  summarize,
  validateCustomPeriod,
} from "../lib/stats";

function readChoice(params: URLSearchParams): PeriodChoice {
  const from = params.get("from");
  const to = params.get("to");
  if (from !== null || to !== null) return { kind: "custom", from: from ?? "", to: to ?? "" };
  const days = Number(params.get("range"));
  return { kind: "preset", days: (PRESETS as number[]).includes(days) ? (days as Preset) : 7 };
}

/** Diet stats: streak, goals, period picker, charts and averages. */
function DietStatsPage() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const choice = readChoice(params);
  const error = choice.kind === "custom" ? validateCustomPeriod(choice.from, choice.to, today) : null;
  const period: Period =
    choice.kind === "preset"
      ? presetPeriod(choice.days, today)
      : { start: choice.from, end: choice.to };

  const range = useDiaryRange(period.start, period.end, error === null);
  const { data: goal } = useGoal();
  const activeGoal = goal ?? null;

  const days = error === null ? (range.data?.days ?? []) : [];
  const points = chartPoints(days);
  const summary = summarize(days, activeGoal);

  function setPreset(daysCount: Preset) {
    setParams({ range: String(daysCount) }, { replace: true });
  }
  function openCustom() {
    setParams({ from: period.start, to: period.end }, { replace: true });
  }
  function setDates(from: string, to: string) {
    setParams({ from, to }, { replace: true });
  }

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-[17px] font-semibold text-slate-900">Statistiche</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <StreakCard />
        <GoalForm />
        <PeriodPicker
          choice={choice}
          today={today}
          error={error}
          onPreset={setPreset}
          onCustom={openCustom}
          onDates={setDates}
        />
        {error !== null ? null : range.isError ? (
          <p role="alert" className="card px-4 py-3 text-sm text-red-600">
            Impossibile caricare le statistiche.
          </p>
        ) : range.isLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>
        ) : (
          <>
            <KcalChart points={points} goalKcal={activeGoal?.kcal ?? null} />
            <MacroChart points={points} />
            <MacroSplitBars
              consumed={summary.averages ? macroSplit(summary.averages) : null}
              target={activeGoal ? macroSplit(activeGoal) : null}
            />
            <SummaryTable summary={summary} />
          </>
        )}
      </div>
    </div>
  );
}

export default DietStatsPage;
