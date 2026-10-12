import { useEffect, useRef, useState } from "react";

import type { SetValues, Tracking, WorkoutSet } from "../../api/gym";
import { FIELD_META, formatSet, setFields, setGridColumns } from "../../lib/gym";
import { hapticSetComplete } from "../../native/haptics";
import ActionMenu from "./ActionMenu";
import NumberInput from "./NumberInput";

const SAVE_DELAY_MS = 500;

function pick(values: SetValues): SetValues {
  return { weight_kg: values.weight_kg, reps: values.reps, duration_s: values.duration_s };
}

interface SetRowProps {
  index: number;
  tracking: Tracking;
  set: WorkoutSet;
  onSave: (values: SetValues) => void;
  onComplete: (values: SetValues) => void;
  onUncomplete: () => void;
  onDelete: () => void;
}

/** One row of the live table: Serie | Precedente | kg | Rip. | ✓.
 *
 * Typed values live here first and reach the server after 500 ms of quiet,
 * on blur or on unmount. The tick sends the current values together with
 * the completion (and cancels the pending save), so nothing typed is lost
 * when the user ticks right after typing. While no local edit is pending the
 * row follows the server's values. */
function SetRow({ index, tracking, set, onSave, onComplete, onUncomplete, onDelete }: SetRowProps) {
  const [values, setValues] = useState<SetValues>(() => pick(set));
  const latest = useRef(values);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useEffect(() => {
    if (timer.current === null) {
      const next = pick(set);
      latest.current = next;
      setValues(next);
    }
  }, [set.weight_kg, set.reps, set.duration_s]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        saveRef.current(latest.current);
      }
    },
    [],
  );

  function flush() {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    onSave(latest.current);
  }

  function change(patch: Partial<SetValues>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setValues(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }

  function deleteSet() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    onDelete();
  }

  function toggle() {
    if (set.completed_at) {
      onUncomplete();
      return;
    }
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    hapticSetComplete();
    onComplete(latest.current);
  }

  const done = set.completed_at !== null;
  const fields = setFields(tracking);
  const number = index + 1;

  return (
    <div
      className={`grid items-center gap-2 rounded-lg px-1 py-1 transition-colors ${done ? "bg-brand-50" : ""}`}
      style={{ gridTemplateColumns: setGridColumns(fields.length) }}
    >
      <ActionMenu
        label={`Serie ${number}`}
        trigger={number}
        triggerClassName="h-9 w-full rounded-lg bg-slate-100 text-[15px] font-semibold text-slate-700"
        actions={[{ label: "Elimina serie", onSelect: deleteSet, destructive: true }]}
      />
      <div className="min-w-0">
        <button
          type="button"
          aria-label={`Usa precedente serie ${number}`}
          disabled={!set.previous}
          onClick={() => set.previous && change(pick(set.previous))}
          className="block w-full truncate text-center text-[14px] text-slate-400"
        >
          {set.previous ? formatSet(tracking, set.previous) : "—"}
        </button>
        {set.max_set && (
          <span className="block truncate text-center text-[11px] leading-tight text-slate-400">
            <span aria-hidden="true">{`max ${formatSet(tracking, set.max_set)}`}</span>
            <span className="sr-only">
              {`Massimo serie ${number}: ${formatSet(tracking, set.max_set)}`}
            </span>
          </span>
        )}
      </div>
      {fields.map((field) => (
        <NumberInput
          key={field}
          label={`${FIELD_META[field].label} serie ${number}`}
          kind={FIELD_META[field].kind}
          value={values[field]}
          onChange={(value) => change({ [field]: value } as Partial<SetValues>)}
          onBlur={flush}
        />
      ))}
      <button
        type="button"
        aria-label={done ? `Annulla serie ${number}` : `Completa serie ${number}`}
        aria-pressed={done}
        onClick={toggle}
        className={`flex h-9 w-full items-center justify-center rounded-lg transition ${
          done ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-500 active:bg-slate-200"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
          <path d="m5 12 5 5 9-10" />
        </svg>
      </button>
    </div>
  );
}

export default SetRow;
