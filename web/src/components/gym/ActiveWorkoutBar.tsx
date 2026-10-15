import { Link } from "react-router-dom";

import { elapsedLabel } from "../../lib/gym";
import { useNow } from "../../lib/useNow";
import { useActiveSession } from "../../native/localSession";

/** Green strip above the tab bar while a workout is live, on every page of
 * both sections; tapping it reopens the session. In the app it reads the local state. */
function ActiveWorkoutBar() {
  const { data: workout } = useActiveSession();
  const now = useNow(1000);
  if (!workout) return null;
  return (
    <>
      <div aria-hidden className="h-11" />
      <Link
        to="/gym/workout"
        className="fixed inset-x-0 bottom-[var(--nav-height)] z-30 flex items-center justify-between gap-3 bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sheet"
      >
        <span className="truncate">Allenamento in corso · {workout.name}</span>
        <span className="tabular-nums">{elapsedLabel(workout.started_at, now)}</span>
      </Link>
    </>
  );
}

export default ActiveWorkoutBar;
