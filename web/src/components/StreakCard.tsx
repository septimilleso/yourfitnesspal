import { useStreak } from "../api/queries";
import BadgeGrid from "./BadgeGrid";
import type { AppMode } from "../lib/appMode";

/** "N giorni di fila" card at the top of both stats pages. */
function StreakCard({ mode }: { mode: AppMode }) {
  const { data, isLoading, isError } = useStreak();

  let body: React.ReactNode;
  if (isError) {
    body = <p className="text-sm text-red-600">Impossibile caricare la serie.</p>;
  } else if (isLoading || !data) {
    body = <p className="text-sm text-slate-500">Caricamento...</p>;
  } else {
    body = (
      <div>
        <p className="text-[17px] font-semibold text-slate-900">
          {data.current === 0
            ? "Inizia oggi la tua serie"
            : `${data.current} ${data.current === 1 ? "giorno" : "giorni"} di fila`}
        </p>
        <p className="text-sm text-slate-500">Record: {data.best}</p>
      </div>
    );
  }

  return (
    <section className="card space-y-3 px-4 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-3xl leading-none">🔥</span>
        {body}
      </div>
      {data && !isLoading && !isError && <BadgeGrid mode={mode} current={data.current} />}
    </section>
  );
}

export default StreakCard;
