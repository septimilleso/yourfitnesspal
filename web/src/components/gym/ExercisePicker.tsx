import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";

import type { Exercise, ExerciseFilters } from "../../api/gym";
import { EMPTY_FILTERS, useExercises } from "../../api/gym";
import { localExercises } from "../../lib/localExercises";
import { useDebounced } from "../../lib/useDebounced";
import { isOffline, subscribeConnectivity } from "../../native/connectivity";
import { isNative } from "../../native/platform";
import OfflineUnavailable from "../OfflineUnavailable";
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

// Offline nell'IPA come nel resto dell'app: il selettore cerca tra gli esercizi già sul dispositivo (R14).
function useLocalPicker(): boolean {
  const offline = useSyncExternalStore(subscribeConnectivity, isOffline);
  return isNative() && offline;
}

interface LocalExerciseListProps {
  filters: ExerciseFilters;
  selectedIds?: Set<number>;
  onSelect: (exercise: Exercise) => void;
}

function LocalExerciseList({ filters, selectedIds, onSelect }: LocalExerciseListProps) {
  const queryClient = useQueryClient();
  const items = localExercises(queryClient, filters);
  // ExerciseList legge una query: qui i dati sono già sul dispositivo, quindi la forma è quella di una query riuscita.
  const query = { data: { items, total: items.length }, isLoading: false, isError: false } as unknown as ReturnType<
    typeof useExercises
  >;
  return <ExerciseList query={query} selectedIds={selectedIds} onSelect={onSelect} />;
}

function ExercisePicker({ title = "Aggiungi esercizi", multiple = true, onPick, onClose }: ExercisePickerProps) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const q = useDebounced(filters.q, 250);
  const query = useExercises({ ...filters, q });
  const offline = useLocalPicker();
  const [selected, setSelected] = useState<Exercise[]>([]);
  const [creating, setCreating] = useState(false);
  const selectedIds = multiple ? new Set(selected.map((item) => item.id)) : undefined;

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
        {offline ? (
          <LocalExerciseList filters={filters} selectedIds={selectedIds} onSelect={select} />
        ) : (
          <ExerciseList query={query} selectedIds={selectedIds} onSelect={select} />
        )}
      </div>
      {creating &&
        (offline ? (
          <Sheet title="Nuovo esercizio" onClose={() => setCreating(false)}>
            <OfflineUnavailable />
          </Sheet>
        ) : (
          <CustomExerciseForm
            onClose={() => setCreating(false)}
            onSaved={(exercise) => {
              setCreating(false);
              select(exercise);
            }}
          />
        ))}
    </Sheet>
  );
}

export default ExercisePicker;
