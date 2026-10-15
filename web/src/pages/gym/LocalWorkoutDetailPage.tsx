import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { type Template, fetchTemplate, gymKeys } from "../../api/gym";
import OfflineIndicator from "../../components/OfflineIndicator";
import { durationLabel, formatSet, workoutDateLabel } from "../../lib/gym";
import { type DiffExercise, templateDiff } from "../../lib/gymRules";
import type { SessionWorkout } from "../../lib/gymSession";
import { confirmedServerId } from "../../native/gymSync";
import { type GymEntry, type GymStoreData, getSnapshot, subscribe } from "../../native/gymStore";

// Un allenamento finito solo sul telefono (R19, R22): il riepilogo è letto dallo stato locale, senza richieste.
// Quando il server conferma la fine, la rotta passa a quella dello Storico.

function entryOf(store: GymStoreData, uuid: string): GymEntry | undefined {
  if (store.active?.workout.uuid === uuid) return store.active;
  return store.finished.find((entry) => entry.workout.uuid === uuid);
}

// Le stesse voci che `template_diff` riceve sul server: esercizio, tracking, riposo, superserie e serie.
function templateItems(template: Template): DiffExercise[] {
  return template.exercises.map((item) => ({
    exercise_id: item.exercise.id,
    name: item.exercise.name,
    tracking: item.exercise.tracking,
    rest_seconds: item.rest_seconds,
    superset_group: item.superset_group,
    sets: item.sets,
  }));
}

function workoutItems(workout: SessionWorkout): DiffExercise[] {
  return workout.exercises.map((item) => ({
    exercise_id: item.exercise_id,
    name: item.name,
    tracking: item.tracking,
    rest_seconds: item.rest_seconds,
    superset_group: item.superset_group,
    sets: item.sets,
  }));
}

/** Dettaglio locale di un allenamento finito. Con `?summary=1` (dopo Termina) è il riepilogo: senza sync non si
 * aggiorna il modello, quindi al posto dei pulsanti c'è solo la nota. */
function LocalWorkoutDetailPage() {
  const { uuid = "" } = useParams();
  const [params] = useSearchParams();
  const summary = params.get("summary") === "1";
  const navigate = useNavigate();
  const store = useSyncExternalStore(subscribe, getSnapshot);
  const entry = entryOf(store, uuid);
  // Il modello si legge solo dalla cache: `enabled: false` non fa richieste. Se non c'è, nessuna modifica da mostrare.
  const templateId = entry?.workout.template_id ?? null;
  const { data: template } = useQuery({
    queryKey: gymKeys.template(templateId ?? 0),
    queryFn: () => fetchTemplate(templateId ?? 0),
    enabled: false,
  });

  if (entry === undefined) {
    // Uscita dallo stato locale: il server l'ha confermata (si va al suo dettaglio) oppure l'allenamento non c'è più.
    const serverId = confirmedServerId(uuid);
    if (serverId === null) return <Navigate to="/gym/history" replace />;
    return <Navigate to={summary ? `/gym/history/${serverId}?summary=1` : `/gym/history/${serverId}`} replace />;
  }

  const { workout } = entry;
  const diff = template ? templateDiff(templateItems(template), workoutItems(workout)) : [];

  return (
    <div>
      <header className="app-header">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <button type="button" className="btn-ghost" onClick={() => navigate(summary ? "/gym" : "/gym/history")}>
            {summary ? "Chiudi" : "‹ Storico"}
          </button>
          <div className="flex min-w-0 items-center gap-1">
            <h1 className="min-w-0 truncate text-[17px] font-semibold text-slate-900">
              {summary ? "Allenamento completato" : workout.name}
            </h1>
            <OfflineIndicator className="relative inline-flex shrink-0" />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="card p-4">
          <h2 className="text-xl font-bold text-slate-900">{workout.name}</h2>
          <p className="text-sm capitalize text-slate-500">{workoutDateLabel(workout.started_at)}</p>
          {workout.finished_at && (
            <p className="mt-1 text-sm font-semibold text-slate-700">
              {durationLabel(workout.started_at, workout.finished_at)}
            </p>
          )}
        </div>

        {diff.length > 0 && (
          <section className="card border-sky-200 bg-sky-50 p-4">
            <h2 className="text-[15px] font-semibold text-slate-900">Modifiche rispetto al modello</h2>
            <ul className="mt-2 space-y-1 text-[14px] text-slate-700">
              {diff.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </section>
        )}
        {summary && (
          <p role="status" className="text-center text-sm text-slate-500">
            Potrai aggiornare il modello dopo la sincronizzazione
          </p>
        )}

        {workout.exercises.map((item) => (
          <section key={item.uuid} className="card p-4" aria-label={item.name}>
            <h3 className="text-[16px] font-semibold text-sky-600">{item.name}</h3>
            <ol className="mt-2 space-y-1">
              {item.sets.map((set, index) => (
                <li key={set.uuid} className="flex gap-3 text-[15px] text-slate-700">
                  <span className="w-6 font-semibold text-slate-400">{index + 1}</span>
                  <span>{formatSet(item.tracking, set)}</span>
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
      </div>
    </div>
  );
}

export default LocalWorkoutDetailPage;
