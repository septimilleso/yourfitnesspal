import { Fragment } from "react";

import type { WorkoutExercise } from "../../api/gym";
import { FIELD_META, formatDuration, restLabel, setFields, setGridColumns } from "../../lib/gym";
import { keyOf, type LiveSession } from "../../lib/liveSession";
import ActionMenu, { type Action } from "./ActionMenu";
import SetRow from "./SetRow";

interface WorkoutExerciseCardProps {
  session: LiveSession;
  item: WorkoutExercise;
  /** Exercise-level menu, built by the page (it knows the whole layout). */
  actions: Action[];
  onShowExercise: () => void;
  onPickRest: () => void;
}

function WorkoutExerciseCard({ session, item, actions, onShowExercise, onPickRest }: WorkoutExerciseCardProps) {
  const exerciseUuid = keyOf(item);
  const fields = setFields(item.exercise.tracking);
  const inSuperset = item.superset_group !== null;

  return (
    <section
      aria-label={item.exercise.name}
      className={`card p-3 ${inSuperset ? "border-l-4 border-l-sky-400" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onShowExercise}
          className="min-w-0 truncate text-left text-[17px] font-semibold text-sky-600"
        >
          {item.exercise.name}
        </button>
        <ActionMenu label={`Azioni ${item.exercise.name}`} actions={actions} />
      </div>
      {inSuperset && <p className="text-xs font-semibold uppercase tracking-wide text-sky-500">Superserie</p>}
      {item.note && <p className="mt-1 text-sm italic text-slate-500">{item.note}</p>}

      <div
        className="mt-2 grid gap-2 px-1 text-center text-[13px] font-semibold text-slate-600"
        style={{ gridTemplateColumns: setGridColumns(fields.length) }}
      >
        <span>Serie</span>
        <span>Precedente</span>
        {fields.map((field) => (
          <span key={field}>{FIELD_META[field].label}</span>
        ))}
        <span aria-hidden>✓</span>
      </div>

      <div className="mt-1 space-y-1">
        {item.sets.map((set, index) => (
          <Fragment key={keyOf(set)}>
            <SetRow
              index={index}
              tracking={item.exercise.tracking}
              set={set}
              onSave={(values) => session.patchSet(keyOf(set), values)}
              onComplete={(values) => session.completeSet(keyOf(set), values)}
              onUncomplete={() => session.uncompleteSet(keyOf(set))}
              onDelete={() => session.deleteSet(keyOf(set))}
            />
            {item.rest_seconds > 0 && (
              <button
                type="button"
                onClick={onPickRest}
                aria-label={`Riposo ${restLabel(item.rest_seconds)}`}
                className="flex w-full items-center gap-2 text-[13px] font-semibold tabular-nums text-sky-600"
              >
                <span className="h-0.5 flex-1 rounded bg-sky-100" />
                {formatDuration(item.rest_seconds)}
                <span className="h-0.5 flex-1 rounded bg-sky-100" />
              </button>
            )}
          </Fragment>
        ))}
      </div>

      <button
        type="button"
        onClick={() => session.addSet(exerciseUuid)}
        className="mt-2 w-full rounded-lg bg-slate-100 py-2 text-[15px] font-semibold text-slate-700 active:bg-slate-200"
      >
        + Aggiungi serie ({restLabel(item.rest_seconds)})
      </button>
    </section>
  );
}

export default WorkoutExerciseCard;
