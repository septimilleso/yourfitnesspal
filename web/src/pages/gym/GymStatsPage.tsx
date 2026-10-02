import ModeSwitch from "../../components/ModeSwitch";
import WorkoutCountCard from "../../components/WorkoutCountCard";

/** Gym statistics and workout count. */
function GymStatsPage() {
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
      </div>
    </div>
  );
}

export default GymStatsPage;
