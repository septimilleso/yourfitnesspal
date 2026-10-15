import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";

import type { HistoryItem } from "../../api/gym";
import { useDeleteWorkout, useHistory } from "../../api/gym";
import ModeSwitch from "../../components/ModeSwitch";
import OfflineUnavailable from "../../components/OfflineUnavailable";
import SwipeableCard from "../../components/gym/SwipeableCard";
import { durationLabel, monthLabel, workoutDateLabel } from "../../lib/gym";
import { mascot } from "../../lib/art";
import { useOfflineUnavailable } from "../../lib/useOfflineUnavailable";
import { type GymEntry, getSnapshot, subscribe } from "../../native/gymStore";
import { isNative } from "../../native/platform";

const SHOWN_EXERCISES = 4;

function finishedTime(entry: GymEntry): number {
  return Date.parse(entry.workout.finished_at ?? "") || 0;
}

function syncLabel(entry: GymEntry): string {
  if (entry.sync === "conflict") return "Conflitto";
  if (entry.sync === "error") return "Errore di sincronizzazione";
  return "Da sincronizzare";
}

/** Un allenamento finito solo sul telefono (R22): non ha il menu né lo scorrimento per eliminare. */
function LocalHistoryCard({ entry }: { entry: GymEntry }) {
  const { workout } = entry;
  return (
    <Link to={`/gym/history/local/${workout.uuid}`} className="card block p-4 active:bg-slate-50">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-[16px] font-semibold text-slate-900">{workout.name}</h3>
        {workout.finished_at && (
          <span className="shrink-0 text-xs text-slate-500">
            {durationLabel(workout.started_at, workout.finished_at)}
          </span>
        )}
      </div>
      <p className="text-[13px] capitalize text-slate-500">{workoutDateLabel(workout.started_at)}</p>
      <p className={`mt-1 text-[12px] font-semibold ${entry.sync === "pending" ? "text-amber-700" : "text-red-600"}`}>
        {syncLabel(entry)}
      </p>
      <ul className="mt-2 space-y-0.5 text-[14px] text-slate-700">
        {workout.exercises.slice(0, SHOWN_EXERCISES).map((exercise, index) => (
          <li key={`${exercise.name}-${index}`}>
            {exercise.sets.length} × {exercise.name}
          </li>
        ))}
        {workout.exercises.length > SHOWN_EXERCISES && (
          <li className="text-slate-400">+{workout.exercises.length - SHOWN_EXERCISES} altri</li>
        )}
      </ul>
    </Link>
  );
}

/** Finished workouts, newest first, grouped by month. Nell'IPA, sopra, quelli ancora solo sul telefono. */
function HistoryPage() {
  const history = useHistory();
  const historyUnavailable = useOfflineUnavailable(history);
  const removeWorkout = useDeleteWorkout();
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const store = useSyncExternalStore(subscribe, getSnapshot);
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const groups: { label: string; items: HistoryItem[] }[] = [];
  for (const item of items) {
    const label = monthLabel(item.finished_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  // Un allenamento con un id già nello Storico non si mostra due volte: la voce locale sparisce alla conferma del server.
  const serverIds = new Set(items.map((item) => item.id));
  const localEntries = (isNative() ? store.finished : [])
    .filter((entry) => entry.workout.id === null || !serverIds.has(entry.workout.id))
    .sort((a, b) => finishedTime(b) - finishedTime(a));

  useEffect(() => {
    if (openId === null) return;

    function closeIfOutside(event: Event) {
      const target = event.target;
      const card = target instanceof Element ? target.closest<HTMLElement>("[data-swipeable-id]") : null;
      if (card?.dataset.swipeableId !== String(openId)) {
        setDeleteError(false);
        setOpenId(null);
      }
    }

    document.addEventListener("touchstart", closeIfOutside, true);
    document.addEventListener("pointerdown", closeIfOutside, true);
    return () => {
      document.removeEventListener("touchstart", closeIfOutside, true);
      document.removeEventListener("pointerdown", closeIfOutside, true);
    };
  }, [openId]);

  function deleteWorkout(id: number) {
    if (removeWorkout.isPending) return;
    setDeleteError(false);
    if (!window.confirm("Eliminare questo allenamento dallo storico?")) {
      setOpenId(null);
      return;
    }

    removeWorkout.mutate(id, {
      onSuccess: () => {
        setDeleteError(false);
        setOpenId(null);
      },
      onError: () => setDeleteError(true),
    });
  }

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3 text-center">
          <h1 className="text-[17px] font-semibold text-slate-900">Storico</h1>
        </div>
      </header>
      <div className="mx-auto max-w-2xl space-y-5 p-4">
        {localEntries.length > 0 && (
          <section className="space-y-3">
            {localEntries.map((entry) => (
              <LocalHistoryCard key={entry.workout.uuid} entry={entry} />
            ))}
          </section>
        )}
        {historyUnavailable && <OfflineUnavailable />}
        {!historyUnavailable && history.isLoading && (
          <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>
        )}
        {!historyUnavailable && history.isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">Errore nel caricamento dello storico.</p>
        )}
        {!historyUnavailable && history.data && items.length === 0 && localEntries.length === 0 && (
          <div className="card px-4 py-6 text-center">
            <img
              src={mascot("gym")}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="mx-auto mb-3 h-[120px] w-auto object-contain"
            />
            <p className="text-sm text-slate-500">Nessun allenamento completato.</p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.label} className="space-y-3">
            <h2 className="section-label capitalize">{group.label}</h2>
            {group.items.map((item) => (
              <div key={item.id} data-swipeable-id={item.id}>
                <SwipeableCard
                  open={openId === item.id}
                  onOpenChange={(open) => {
                    setDeleteError(false);
                    setOpenId(open ? item.id : null);
                  }}
                  onDelete={() => deleteWorkout(item.id)}
                >
                  <Link to={`/gym/history/${item.id}`} className="card block p-4 active:bg-slate-50">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="truncate text-[16px] font-semibold text-slate-900">{item.name}</h3>
                      <span className="shrink-0 text-xs text-slate-500">
                        {durationLabel(item.started_at, item.finished_at)}
                      </span>
                    </div>
                    <p className="text-[13px] capitalize text-slate-500">{workoutDateLabel(item.started_at)}</p>
                    <ul className="mt-2 space-y-0.5 text-[14px] text-slate-700">
                      {item.exercises.slice(0, SHOWN_EXERCISES).map((exercise, index) => (
                        <li key={`${exercise.name}-${index}`}>
                          {exercise.sets} × {exercise.name}
                        </li>
                      ))}
                      {item.exercises.length > SHOWN_EXERCISES && (
                        <li className="text-slate-400">+{item.exercises.length - SHOWN_EXERCISES} altri</li>
                      )}
                    </ul>
                  </Link>
                </SwipeableCard>
                {deleteError && openId === item.id && (
                  <p role="alert" className="card mt-2 px-4 py-3 text-center text-sm text-red-600">
                    Impossibile eliminare l'allenamento.
                  </p>
                )}
              </div>
            ))}
          </section>
        ))}

        {history.hasNextPage && (
          <button
            type="button"
            className="btn-secondary w-full"
            disabled={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Carica altri
          </button>
        )}
      </div>
    </div>
  );
}

export default HistoryPage;
