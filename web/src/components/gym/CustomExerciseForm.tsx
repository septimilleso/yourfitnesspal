import { useState } from "react";

import type { Exercise, ExerciseDetail, ExerciseInput, Tracking } from "../../api/gym";
import { useCreateExercise, useUpdateExercise } from "../../api/gym";
import { EQUIPMENT_LABELS, MUSCLE_LABELS, TRACKING_LABELS } from "../../lib/gym";
import Sheet from "./Sheet";

interface CustomExerciseFormProps {
  initial?: ExerciseDetail;
  onClose: () => void;
  onSaved: (exercise: Exercise) => void;
}

function CustomExerciseForm({ initial, onClose, onSaved }: CustomExerciseFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [equipment, setEquipment] = useState(initial?.equipment ?? "");
  const [muscle, setMuscle] = useState(initial?.primary_muscles[0] ?? "");
  const [tracking, setTracking] = useState<Tracking>(initial?.tracking ?? "weight_reps");
  const create = useCreateExercise();
  const update = useUpdateExercise();
  const pending = create.isPending || update.isPending;
  const failed = create.isError || update.isError;

  function save() {
    const input: ExerciseInput = {
      name: name.trim(),
      equipment: equipment || null,
      primary_muscle: muscle || null,
      tracking,
    };
    const options = { onSuccess: (exercise: ExerciseDetail) => onSaved(exercise) };
    if (initial) update.mutate({ id: initial.id, ...input }, options);
    else create.mutate(input, options);
  }

  return (
    <Sheet
      title={initial ? "Modifica esercizio" : "Nuovo esercizio"}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={!name.trim() || pending}
          onClick={save}
        >
          Salva
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="exercise-name" className="field-label">
            Nome
          </label>
          <input
            id="exercise-name"
            className="field mt-1.5"
            value={name}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="exercise-equipment" className="field-label">
            Attrezzo
          </label>
          <select
            id="exercise-equipment"
            className="field mt-1.5"
            value={equipment}
            onChange={(event) => setEquipment(event.target.value)}
          >
            <option value="">Nessuno</option>
            {Object.entries(EQUIPMENT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="exercise-muscle" className="field-label">
            Muscolo principale
          </label>
          <select
            id="exercise-muscle"
            className="field mt-1.5"
            value={muscle}
            onChange={(event) => setMuscle(event.target.value)}
          >
            <option value="">Nessuno</option>
            {Object.entries(MUSCLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="field-label">Cosa registri</legend>
          <div className="mt-1.5 space-y-2">
            {(Object.keys(TRACKING_LABELS) as Tracking[]).map((key) => (
              <label key={key} className="flex items-center gap-3 text-[15px] text-slate-800">
                <input
                  type="radio"
                  name="tracking"
                  checked={tracking === key}
                  onChange={() => setTracking(key)}
                />
                {TRACKING_LABELS[key]}
              </label>
            ))}
          </div>
        </fieldset>
        {failed && <p className="text-sm text-red-600">Salvataggio non riuscito.</p>}
      </div>
    </Sheet>
  );
}

export default CustomExerciseForm;
