import { useGymCount } from "../api/gym";
import { artIcon } from "../lib/art";
import { useOfflineUnavailable } from "../lib/useOfflineUnavailable";
import BadgeGrid from "./BadgeGrid";
import OfflineUnavailable from "./OfflineUnavailable";

/** Finished workout count and gym badge progress at the top of gym stats. */
function WorkoutCountCard() {
  const count = useGymCount();
  const { data, isLoading, isError } = count;
  const unavailable = useOfflineUnavailable(count);

  let body: React.ReactNode;
  if (unavailable) {
    body = <OfflineUnavailable compact />;
  } else if (isError) {
    body = <p className="text-sm text-red-600">Impossibile caricare gli allenamenti.</p>;
  } else if (isLoading || !data) {
    body = <p className="text-sm text-slate-500">Caricamento...</p>;
  } else {
    const finished = data.finished;
    body = (
      <>
        <div className="flex items-center gap-3">
          <img src={artIcon("gym", "medal")} alt="" aria-hidden="true" className="h-9 w-9" />
          <p className="text-[17px] font-semibold text-slate-900">
            {finished} {finished === 1 ? "allenamento" : "allenamenti"}
          </p>
        </div>
        <BadgeGrid mode="gym" current={finished} unit="workouts" />
      </>
    );
  }

  return <section className="card space-y-3 px-4 py-3">{body}</section>;
}

export default WorkoutCountCard;
