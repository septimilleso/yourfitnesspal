import ModeSwitch from "../../components/ModeSwitch";
import StreakCard from "../../components/StreakCard";

/** Gym stats: only the streak for now; gym charts come later. */
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
        <StreakCard />
        <section className="card px-4 py-6 text-center text-sm text-slate-500">
          Statistiche palestra in arrivo.
        </section>
      </div>
    </div>
  );
}

export default GymStatsPage;
