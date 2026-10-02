import { useDiaryRange, useGoal } from "../api/queries";
import GoalForm from "../components/GoalForm";
import ModeSwitch from "../components/ModeSwitch";
import StreakCard from "../components/StreakCard";
import KcalChart from "../components/stats/KcalChart";
import MacroChart from "../components/stats/MacroChart";
import MacroSplitBars from "../components/stats/MacroSplitBars";
import PeriodPicker from "../components/stats/PeriodPicker";
import SummaryTable from "../components/stats/SummaryTable";
import WeightSection from "../components/stats/WeightSection";
import { usePeriodParams } from "../lib/usePeriodParams";
import { chartPoints, macroSplit, summarize } from "../lib/stats";

/** Diet stats: streak, goals, period picker, charts and averages. */
function DietStatsPage() {
  const { choice, today, error, period, setPreset, openCustom, setDates } = usePeriodParams();

  const range = useDiaryRange(period.start, period.end, error === null);
  const { data: goal } = useGoal();
  const activeGoal = goal ?? null;

  const days = error === null ? (range.data?.days ?? []) : [];
  const points = chartPoints(days);
  const summary = summarize(days, activeGoal);

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-[17px] font-semibold text-slate-900">Statistiche</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <StreakCard mode="diet" />
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
        <WeightSection period={period} enabled={error === null} />
      </div>
    </div>
  );
}

export default DietStatsPage;
