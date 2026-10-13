import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useApplyToTemplate, useDeleteWorkout, useSaveAsTemplate, useWorkout } from "../../api/gym";
import OfflineUnavailable from "../../components/OfflineUnavailable";
import ActionMenu from "../../components/gym/ActionMenu";
import { durationLabel, formatSet, workoutDateLabel } from "../../lib/gym";
import { useOfflineUnavailable } from "../../lib/useOfflineUnavailable";

/** A finished workout. With `?summary=1` (right after "Termina") it is the
 * end-of-workout summary: if the sets differ from the template it offers to
 * update the template; a workout without template can become one. */
function WorkoutDetailPage() {
  const { id } = useParams();
  const workoutId = Number(id);
  const [params] = useSearchParams();
  const summary = params.get("summary") === "1";
  const navigate = useNavigate();
  const workoutQuery = useWorkout(workoutId);
  const { data: workout, isLoading, isError } = workoutQuery;
  const unavailable = useOfflineUnavailable(workoutQuery);
  const apply = useApplyToTemplate();
  const saveAs = useSaveAsTemplate();
  const remove = useDeleteWorkout();
  const [keepTemplate, setKeepTemplate] = useState(false);

  function saveAsTemplate() {
    if (!workout) return;
    const name = window.prompt("Nome del modello", workout.name)?.trim();
    if (name) saveAs.mutate({ workoutId: workout.id, name });
  }

  function deleteWorkout() {
    if (!window.confirm("Eliminare questo allenamento dallo storico?")) return;
    remove.mutate(workoutId, { onSuccess: () => navigate("/gym/history", { replace: true }) });
  }

  const showDiff = summary && !keepTemplate && (workout?.template_diff.length ?? 0) > 0;

  return (
    <div>
      <header className="app-header">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <button type="button" className="btn-ghost" onClick={() => navigate(summary ? "/gym" : "/gym/history")}>
            {summary ? "Chiudi" : "‹ Storico"}
          </button>
          <h1 className="truncate text-[17px] font-semibold text-slate-900">
            {summary ? "Allenamento completato" : (workout?.name ?? "Allenamento")}
          </h1>
          <ActionMenu
            label="Azioni allenamento"
            actions={[
              { label: "Salva come modello", onSelect: saveAsTemplate },
              { label: "Elimina", onSelect: deleteWorkout, destructive: true },
            ]}
          />
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {unavailable && <OfflineUnavailable />}
        {!unavailable && isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}
        {!unavailable && isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">Allenamento non trovato.</p>
        )}

        {workout && (
          <>
            <div className="card p-4">
              <h2 className="text-xl font-bold text-slate-900">{workout.name}</h2>
              <p className="text-sm capitalize text-slate-500">{workoutDateLabel(workout.started_at)}</p>
              {workout.finished_at && (
                <p className="mt-1 text-sm font-semibold text-slate-700">
                  {durationLabel(workout.started_at, workout.finished_at)}
                </p>
              )}
            </div>

            {showDiff && (
              <section className="card border-sky-200 bg-sky-50 p-4">
                <h2 className="text-[15px] font-semibold text-slate-900">Modifiche rispetto al modello</h2>
                <ul className="mt-2 space-y-1 text-[14px] text-slate-700">
                  {workout.template_diff.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    disabled={apply.isPending}
                    onClick={() => apply.mutate(workout.id)}
                  >
                    Aggiorna modello
                  </button>
                  <button type="button" className="btn-secondary flex-1" onClick={() => setKeepTemplate(true)}>
                    Mantieni modello
                  </button>
                </div>
              </section>
            )}
            {apply.isSuccess && (
              <p role="status" className="text-center text-sm font-semibold text-brand-700">
                Modello aggiornato.
              </p>
            )}

            {summary && workout.template_id === null && !saveAs.isSuccess && (
              <button type="button" className="btn-secondary w-full" onClick={saveAsTemplate}>
                Salva come modello
              </button>
            )}
            {saveAs.isSuccess && (
              <p role="status" className="text-center text-sm font-semibold text-brand-700">
                Modello salvato.
              </p>
            )}

            {workout.exercises.map((item) => (
              <section key={item.id} className="card p-4" aria-label={item.exercise.name}>
                <h3 className="text-[16px] font-semibold text-sky-600">{item.exercise.name}</h3>
                <ol className="mt-2 space-y-1">
                  {item.sets.map((set, index) => (
                    <li key={set.id} className="flex gap-3 text-[15px] text-slate-700">
                      <span className="w-6 font-semibold text-slate-400">{index + 1}</span>
                      <span>{formatSet(item.exercise.tracking, set)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ))}

            {summary && (
              <Link to="/gym" className="btn-primary w-full">
                Fine
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default WorkoutDetailPage;
