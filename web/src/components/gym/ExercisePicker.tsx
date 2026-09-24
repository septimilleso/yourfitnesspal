import { useState } from "react";

import type { Exercise } from "../../api/gym";
import { EMPTY_FILTERS, useExercises } from "../../api/gym";
import { useDebounced } from "../../lib/useDebounced";
import CustomExerciseForm from "./CustomExerciseForm";
import ExerciseFilterBar from "./ExerciseFilterBar";
import ExerciseList from "./ExerciseList";
import Sheet from "./Sheet";

interface ExercisePickerProps {
  title?: string;
  /** Several exercises at once (add) or exactly one (replace). */
  multiple?: boolean;
  onPick: (exercises: Exercise[]) => void;
  onClose: () => void;
}

function ExercisePicker({ title = "Aggiungi esercizi", multiple = true, onPick, onClose }: ExercisePickerProps) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const q = useDebounced(filters.q, 250);
  const query = useExercises({ ...filters, q });
  const [selected, setSelected] = useState<Exercise[]>([]);
  const [creating, setCreating] = useState(false);

  function select(exercise: Exercise) {
    if (!multiple) {
      onPick([exercise]);
      return;
    }
    setSelected((current) =>
      current.some((item) => item.id === exercise.id)
        ? current.filter((item) => item.id !== exercise.id)
        : [...current, exercise],
    );
  }

  return (
    <Sheet
      title={title}
      full
      onClose={onClose}
      headerAction={
        <button type="button" className="btn-ghost text-sky-600" onClick={() => setCreating(true)}>
          + Nuovo
        </button>
      }
      footer={
        multiple ? (
          <button
            type="button"
            className="btn-primary w-full"
            disabled={selected.length === 0}
            onClick={() => onPick(selected)}
          >
            Aggiungi ({selected.length})
          </button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <ExerciseFilterBar value={filters} onChange={setFilters} />
        <ExerciseList
          query={query}
          selectedIds={multiple ? new Set(selected.map((item) => item.id)) : undefined}
          onSelect={select}
        />
      </div>
      {creating && (
        <CustomExerciseForm
          onClose={() => setCreating(false)}
          onSaved={(exercise) => {
            setCreating(false);
            select(exercise);
          }}
        />
      )}
    </Sheet>
  );
}

export default ExercisePicker;
