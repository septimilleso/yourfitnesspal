import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { HistoryItem } from "../../api/gym";
import { useDeleteWorkout, useHistory } from "../../api/gym";
import ModeSwitch from "../../components/ModeSwitch";
import SwipeableCard from "../../components/gym/SwipeableCard";
import { durationLabel, monthLabel, workoutDateLabel } from "../../lib/gym";
import { mascot } from "../../lib/art";

const SHOWN_EXERCISES = 4;

/** Finished workouts, newest first, grouped by month. */
function HistoryPage() {
  const history = useHistory();
  const removeWorkout = useDeleteWorkout();
  const [openId, setOpenId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const groups: { label: string; items: HistoryItem[] }[] = [];
  for (const item of items) {
    const label = monthLabel(item.finished_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

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
        {deleteError && (
          <p role="alert" className="card px-4 py-3 text-center text-sm text-red-600">
            Impossibile eliminare l'allenamento.
          </p>
        )}
        {history.isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}
        {history.isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">Errore nel caricamento dello storico.</p>
        )}
        {history.data && items.length === 0 && (
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
