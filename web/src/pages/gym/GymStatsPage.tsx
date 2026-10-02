import { useGymStats } from "../../api/gym";
import GymSummaryCard from "../../components/stats/GymSummaryCard";
import PeriodPicker from "../../components/stats/PeriodPicker";
import WeeklyFrequencyChart from "../../components/stats/WeeklyFrequencyChart";
import ModeSwitch from "../../components/ModeSwitch";
import WorkoutCountCard from "../../components/WorkoutCountCard";
import { usePeriodParams } from "../../lib/usePeriodParams";

/** Gym statistics and workout count. */
function GymStatsPage() {
  const { choice, today, error, period, setPreset, openCustom, setDates } = usePeriodParams();
  const stats = useGymStats(period.start, period.end, error === null);

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-[17px] font-semibold text-slate-900">Statistiche</h1>
        </div>
      </header>
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <WorkoutCountCard />
        <PeriodPicker
          choice={choice}
          today={today}
          error={error}
          onPreset={setPreset}
          onCustom={openCustom}
          onDates={setDates}
        />
        {error !== null ? null : stats.isError ? (
          <p role="alert" className="card px-4 py-3 text-sm text-red-600">
            Impossibile caricare le statistiche.
          </p>
        ) : stats.isLoading || !stats.data ? (
          <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>
        ) : (
          <>
            <GymSummaryCard stats={stats.data} />
            <WeeklyFrequencyChart weeks={stats.data.weeks} />
          </>
        )}
      </div>
    </div>
  );
}

export default GymStatsPage;
