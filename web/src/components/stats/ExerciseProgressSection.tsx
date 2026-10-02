import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useExerciseProgress, usePerformedExercises, type Tracking } from "../../api/gym";
import type { Period } from "../../lib/stats";
import { formatIsoDateLong } from "../../lib/date";
import ProgressChart from "./ProgressChart";
import PersonalRecords from "./PersonalRecords";

interface MetricOption {
  key: string;
  label: string;
}

function metricOptions(tracking: Tracking, hasWeightedReps: boolean): MetricOption[] {
  if (tracking === "weight_reps") {
    return [
      { key: "max_weight_kg", label: "Carico max" },
      { key: "max_1rm_kg", label: "1RM stimato" },
      { key: "volume_kg", label: "Volume" },
    ];
  }
  if (tracking === "reps") {
    return [
      { key: "max_reps", label: "Reps max" },
      { key: "total_reps", label: "Reps totali" },
      ...(hasWeightedReps
        ? [
            { key: "max_weight_kg", label: "Carico max" },
            { key: "volume_kg", label: "Volume" },
          ]
        : []),
    ];
  }
  return [
    { key: "max_duration_s", label: "Durata max" },
    { key: "total_duration_s", label: "Durata totale" },
  ];
}

/** Exercise selection, per-session progress and all-time records. */
function ExerciseProgressSection({ period, enabled }: { period: Period; enabled: boolean }) {
  const [params, setParams] = useSearchParams();
  const [metric, setMetric] = useState<string | null>(null);
  const exercises = usePerformedExercises();
  const list = exercises.data ?? [];
  const requestedId = Number(params.get("exercise"));
  const selected = list.find((exercise) => exercise.exercise_id === requestedId) ?? list[0];
  const exerciseId = selected?.exercise_id ?? 0;
  const progress = useExerciseProgress(exerciseId, period.start, period.end, enabled && selected !== undefined);

  if (exercises.isError) {
    return <p role="alert" className="card px-4 py-3 text-sm text-red-600">Impossibile caricare gli esercizi.</p>;
  }
  if (exercises.isLoading && !exercises.data) {
    return <p className="card px-4 py-3 text-center text-sm text-slate-500">Caricamento esercizi...</p>;
  }
  if (list.length === 0) {
    return <p className="card px-4 py-3 text-center text-sm text-slate-500">Completa un allenamento per vedere i progressi</p>;
  }

  const hasWeightedReps = (progress.data?.sessions ?? []).some(
    (session) => "max_weight_kg" in session.metrics || "volume_kg" in session.metrics,
  );
  const options = metricOptions(selected.tracking, hasWeightedReps);
  const selectedMetric = options.some((option) => option.key === metric) ? metric! : options[0].key;
  const points = (progress.data?.sessions ?? [])
    .filter((session) => session.metrics[selectedMetric] !== undefined)
    .map((session) => ({ date: session.date, value: session.metrics[selectedMetric] }));

  function selectExercise(value: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("exercise", value);
        return next;
      },
      { replace: true },
    );
    setMetric(null);
  }

  return (
    <section className="space-y-3">
      <div className="card space-y-3 px-4 py-3">
        <h2 className="section-label">Progressione esercizio</h2>
        <label className="block space-y-1 text-sm text-slate-600">
          <span className="sr-only">Esercizio</span>
          <select
            aria-label="Esercizio"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900"
            value={String(selected.exercise_id)}
            onChange={(event) => selectExercise(event.target.value)}
          >
            {list.map((exercise) => (
              <option key={exercise.exercise_id} value={exercise.exercise_id}>{exercise.name}</option>
            ))}
          </select>
        </label>
        {!enabled ? null : progress.isError ? (
          <p role="alert" className="text-sm text-red-600">Impossibile caricare la progressione.</p>
        ) : progress.isLoading || !progress.data ? (
          <p className="py-5 text-center text-sm text-slate-500">Caricamento progressione...</p>
        ) : (
          <>
            {options.length > 1 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Metrica">
                {options.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={selectedMetric === option.key}
                    className={`rounded-full px-3 py-1.5 text-sm ${selectedMetric === option.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
                    onClick={() => setMetric(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            {progress.data.sessions.length === 0 ? (
              <p className="py-5 text-center text-sm text-slate-500">Nessuna sessione nel periodo</p>
            ) : (
              <ProgressChart points={points} />
            )}
          </>
        )}
      </div>
      {enabled && progress.data && !progress.isError && (
        <>
          {progress.data.sessions.length > 0 && (
            <section className="card space-y-2 px-4 py-3">
              <h3 className="section-label">Storico sessioni</h3>
              <ul className="divide-y divide-slate-100">
                {progress.data.sessions.map((session) => (
                  <li key={session.workout_id} className="py-2">
                    <h4 className="text-sm font-medium capitalize text-slate-900">{formatIsoDateLong(session.date)}</h4>
                    <ul className="mt-1 space-y-1 text-sm text-slate-600">
                      {session.sets.map((set, index) => <li key={`${session.workout_id}-${index}`}>{set}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <PersonalRecords records={progress.data.records} />
        </>
      )}
    </section>
  );
}

export default ExerciseProgressSection;
