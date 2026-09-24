import { useState } from "react";

import { EMPTY_FILTERS, useExercises } from "../../api/gym";
import ModeSwitch from "../../components/ModeSwitch";
import CustomExerciseForm from "../../components/gym/CustomExerciseForm";
import ExerciseDetailSheet from "../../components/gym/ExerciseDetailSheet";
import ExerciseFilterBar from "../../components/gym/ExerciseFilterBar";
import ExerciseList from "../../components/gym/ExerciseList";
import { useDebounced } from "../../lib/useDebounced";

/** Browse the catalog plus the user's custom exercises; tap for details,
 * "+ Nuovo" to create a custom one. */
function ExercisesPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const q = useDebounced(filters.q, 250);
  const query = useExercises({ ...filters, q });
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl space-y-2 px-4 py-2">
          <div className="flex items-center justify-between">
            <h1 className="text-[17px] font-semibold text-slate-900">Esercizi</h1>
            <button type="button" className="btn-ghost text-sky-600" onClick={() => setCreating(true)}>
              + Nuovo
            </button>
          </div>
          <ExerciseFilterBar value={filters} onChange={setFilters} />
        </div>
      </header>
      <div className="mx-auto max-w-2xl p-4">
        <ExerciseList query={query} onSelect={(exercise) => setOpenId(exercise.id)} />
      </div>
      {openId !== null && <ExerciseDetailSheet exerciseId={openId} onClose={() => setOpenId(null)} />}
      {creating && (
        <CustomExerciseForm
          onClose={() => setCreating(false)}
          onSaved={(exercise) => {
            setCreating(false);
            setOpenId(exercise.id);
          }}
        />
      )}
    </div>
  );
}

export default ExercisesPage;
