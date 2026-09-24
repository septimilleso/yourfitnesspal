import { useState } from "react";

import { useArchiveExercise, useExercise } from "../../api/gym";
import { equipmentLabel, muscleLabel, TRACKING_LABELS } from "../../lib/gym";
import CustomExerciseForm from "./CustomExerciseForm";
import Sheet from "./Sheet";

interface ExerciseDetailSheetProps {
  exerciseId: number;
  onClose: () => void;
}

function ExerciseDetailSheet({ exerciseId, onClose }: ExerciseDetailSheetProps) {
  const { data, isLoading, isError } = useExercise(exerciseId);
  const archive = useArchiveExercise();
  const [editing, setEditing] = useState(false);

  function remove() {
    if (!window.confirm("Eliminare l'esercizio? Resterà visibile nello storico.")) return;
    archive.mutate(exerciseId, { onSuccess: onClose });
  }

  return (
    <Sheet title={data?.name ?? "Esercizio"} onClose={onClose}>
      {isLoading && <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>}
      {isError && <p className="text-sm text-red-600">Errore nel caricamento.</p>}
      {data && (
        <div className="space-y-4 text-[15px] text-slate-800">
          <dl className="card divide-y divide-slate-100">
            <div className="row justify-between">
              <dt className="text-slate-500">Attrezzo</dt>
              <dd>{equipmentLabel(data.equipment) ?? "—"}</dd>
            </div>
            <div className="row justify-between">
              <dt className="text-slate-500">Muscoli principali</dt>
              <dd className="text-right">{data.primary_muscles.map(muscleLabel).join(", ") || "—"}</dd>
            </div>
            {data.secondary_muscles.length > 0 && (
              <div className="row justify-between">
                <dt className="text-slate-500">Secondari</dt>
                <dd className="text-right">{data.secondary_muscles.map(muscleLabel).join(", ")}</dd>
              </div>
            )}
            <div className="row justify-between">
              <dt className="text-slate-500">Registra</dt>
              <dd>{TRACKING_LABELS[data.tracking]}</dd>
            </div>
          </dl>
          {data.instructions.length > 0 && (
            <section>
              <h3 className="section-label">Istruzioni (inglese)</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-[14px] leading-relaxed text-slate-700">
                {data.instructions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </section>
          )}
          {data.custom && (
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1" onClick={() => setEditing(true)}>
                Modifica
              </button>
              <button
                type="button"
                className="btn-secondary flex-1 text-red-600"
                onClick={remove}
                disabled={archive.isPending}
              >
                Elimina
              </button>
            </div>
          )}
        </div>
      )}
      {editing && data && (
        <CustomExerciseForm initial={data} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
    </Sheet>
  );
}

export default ExerciseDetailSheet;
