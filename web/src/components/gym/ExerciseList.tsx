import type { Exercise, useExercises } from "../../api/gym";
import { exerciseSubtitle } from "../../lib/gym";
import { mascot } from "../../lib/art";

interface ExerciseListProps {
  query: ReturnType<typeof useExercises>;
  /** When given, rows are toggles and show a check when selected. */
  selectedIds?: Set<number>;
  onSelect: (exercise: Exercise) => void;
}

function ExerciseList({ query, selectedIds, onSelect }: ExerciseListProps) {
  if (query.isLoading) return <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>;
  if (query.isError) {
    return <p className="card px-4 py-3 text-center text-sm text-red-600">Errore nel caricamento.</p>;
  }
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <div className="card px-4 py-6 text-center">
        <img
          src={mascot("gym")}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="mx-auto mb-3 h-[120px] w-auto object-contain"
        />
        <p className="text-sm text-slate-500">Nessun esercizio trovato.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="card divide-y divide-slate-100 overflow-hidden">
        {items.map((exercise) => {
          const selected = selectedIds?.has(exercise.id) ?? false;
          return (
            <li key={exercise.id}>
              <button
                type="button"
                onClick={() => onSelect(exercise)}
                aria-pressed={selectedIds ? selected : undefined}
                className={`row w-full text-left active:bg-slate-50 ${selected ? "bg-sky-50" : ""}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-slate-900">
                    {exercise.name}
                  </span>
                  <span className="block truncate text-[13px] text-slate-500">
                    {exerciseSubtitle(exercise)}
                    {exercise.custom && " · Personalizzato"}
                  </span>
                </span>
                {selected && <span aria-hidden className="text-lg text-sky-600">✓</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {query.data && query.data.total > items.length && (
        <p className="text-center text-xs text-slate-500">
          Mostrati {items.length} di {query.data.total}: affina la ricerca.
        </p>
      )}
    </div>
  );
}

export default ExerciseList;
