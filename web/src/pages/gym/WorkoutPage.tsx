import { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { Exercise, WorkoutExercise } from "../../api/gym";
import {
  gymApi,
  useActiveWorkout,
  useCancelWorkout,
  useFinishWorkout,
  useLiveMutation,
} from "../../api/gym";
import type { Action } from "../../components/gym/ActionMenu";
import ExerciseDetailSheet from "../../components/gym/ExerciseDetailSheet";
import ExercisePicker from "../../components/gym/ExercisePicker";
import RestPicker from "../../components/gym/RestPicker";
import RestTimerBar from "../../components/gym/RestTimerBar";
import WorkoutExerciseCard from "../../components/gym/WorkoutExerciseCard";
import {
  elapsedLabel,
  linkWithNext,
  liveErrorMessage,
  moveItem,
  unlinkFromGroup,
} from "../../lib/gym";
import { LiveErrorContext } from "../../lib/liveErrors";
import { installAudioResume, unlockAudio } from "../../lib/restTimer";
import { useNow } from "../../lib/useNow";
import { useVisualViewportTop } from "../../lib/useVisualViewportTop";

type PickerState = { mode: "add" } | { mode: "replace"; itemId: number } | null;

/** The live session (Strong's workout sheet): full screen, no tab bar.
 * Every edit is saved at once through `useLiveMutation`; failures show up
 * as a toast via `LiveErrorContext`. */
function WorkoutPage() {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  return (
    <LiveErrorContext.Provider value={setToast}>
      <WorkoutSession />
      {toast && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-[calc(1rem+var(--safe-bottom))] z-[60] mx-auto max-w-sm rounded-xl bg-red-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-sheet"
        >
          {toast}
        </div>
      )}
    </LiveErrorContext.Provider>
  );
}

function WorkoutSession() {
  const navigate = useNavigate();
  const report = useContext(LiveErrorContext);
  const { data: workout, isLoading, isError } = useActiveWorkout();
  const now = useNow(1000);
  const viewportTop = useVisualViewportTop();
  useEffect(() => installAudioResume(), []);
  const rename = useLiveMutation(gymApi.renameWorkout);
  const addExercise = useLiveMutation(gymApi.addExercise);
  const patchExercise = useLiveMutation(gymApi.patchExercise);
  const removeExercise = useLiveMutation(gymApi.removeExercise);
  const setLayout = useLiveMutation(gymApi.setLayout);
  const rest = useLiveMutation(gymApi.rest);
  const finish = useFinishWorkout();
  const cancel = useCancelWorkout();
  const [picker, setPicker] = useState<PickerState>(null);
  const [restFor, setRestFor] = useState<number | null>(null);
  const [manualRest, setManualRest] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  if (isLoading) return <p className="py-16 text-center text-sm text-slate-500">Caricamento...</p>;
  if (isError) {
    return <p className="p-6 text-center text-sm text-red-600">Errore nel caricamento dell'allenamento.</p>;
  }
  if (!workout) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app p-6 text-center">
        <p className="text-slate-600">Nessun allenamento in corso.</p>
        <Link to="/gym" className="btn-primary">
          Vai ai modelli
        </Link>
      </div>
    );
  }

  const workoutId = workout.id;
  const items = workout.exercises;
  const groups = items.map((item) => item.superset_group);

  function layout(order: WorkoutExercise[], nextGroups: (number | null)[]) {
    setLayout.mutate({
      workoutId,
      items: order.map((item, n) => ({ id: item.id, superset_group: nextGroups[n] })),
    });
  }

  function actionsFor(item: WorkoutExercise, index: number): Action[] {
    const actions: Action[] = [
      { label: "Sostituisci esercizio", onSelect: () => setPicker({ mode: "replace", itemId: item.id }) },
      { label: "Riposo", onSelect: () => setRestFor(item.id) },
      {
        label: item.note ? "Modifica nota" : "Aggiungi nota",
        onSelect: () => {
          const note = window.prompt("Nota", item.note ?? "");
          if (note !== null) {
            patchExercise.mutate({
              workoutId, id: item.id, note: note.trim().slice(0, 500) || null,
            });
          }
        },
      },
    ];
    if (index > 0) {
      actions.push({
        label: "Sposta su",
        onSelect: () => layout(moveItem(items, index, -1), moveItem(groups, index, -1)),
      });
    }
    if (index < items.length - 1) {
      actions.push({
        label: "Sposta giù",
        onSelect: () => layout(moveItem(items, index, 1), moveItem(groups, index, 1)),
      });
      actions.push({ label: "Collega al successivo", onSelect: () => layout(items, linkWithNext(groups, index)) });
    }
    if (item.superset_group !== null) {
      actions.push({ label: "Scollega superserie", onSelect: () => layout(items, unlinkFromGroup(groups, index)) });
    }
    actions.push({
      label: "Rimuovi esercizio",
      destructive: true,
      onSelect: () => {
        if (window.confirm(`Rimuovere ${item.exercise.name} dall'allenamento?`)) {
          removeExercise.mutate({ workoutId, id: item.id });
        }
      },
    });
    return actions;
  }

  function pickExercises(list: Exercise[]) {
    if (picker?.mode === "replace") {
      patchExercise.mutate({ workoutId, id: picker.itemId, exercise_id: list[0].id });
    } else {
      for (const exercise of list) addExercise.mutate({ workoutId, exerciseId: exercise.id });
    }
    setPicker(null);
  }

  function handleFinish() {
    const sets = items.flatMap((item) => item.sets);
    const done = sets.filter((set) => set.completed_at !== null).length;
    const pending = sets.length - done;
    if (done === 0) {
      window.alert("Nessuna serie completata. Completa almeno una serie o annulla l'allenamento.");
      return;
    }
    if (pending > 0 && !window.confirm(`Ci sono ${pending} serie non completate. Verranno scartate.`)) return;
    finish.mutate(
      { workoutId, discardIncomplete: pending > 0 },
      {
        onSuccess: (finished) => navigate(`/gym/history/${finished.id}?summary=1`, { replace: true }),
        onError: (error) => report(liveErrorMessage(error)),
      },
    );
  }

  function handleCancel() {
    if (!window.confirm("Annullare l'allenamento? Le serie registrate verranno eliminate.")) return;
    cancel.mutate(workoutId, {
      onSuccess: () => navigate("/gym", { replace: true }),
      onError: (error) => report(liveErrorMessage(error)),
    });
  }

  const restItem = items.find((item) => item.id === restFor);

  return (
    <div className="min-h-screen bg-app pb-[calc(2rem+var(--safe-bottom))]" onPointerDown={unlockAudio}>
      <header className="app-header" style={viewportTop ? { top: viewportTop } : undefined}>
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <div className="flex">
            <button type="button" aria-label="Riduci" className="btn-ghost w-11" onClick={() => navigate("/gym")}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <button type="button" aria-label="Timer di riposo" className="btn-ghost w-11" onClick={() => setManualRest(true)}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2 2M10 2h4" />
              </svg>
            </button>
          </div>
          <span className="text-[15px] font-semibold tabular-nums text-slate-600">
            {elapsedLabel(workout.started_at, now)}
          </span>
          <button type="button" className="btn-primary px-5" onClick={handleFinish} disabled={finish.isPending}>
            Termina
          </button>
        </div>
        <RestTimerBar
          workout={workout}
          onAdjust={(delta) => rest.mutate({ workoutId, action: { delta_s: delta } })}
          onSkip={() => rest.mutate({ workoutId, action: { skip: true } })}
        />
      </header>

      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <input
          key={workout.name}
          aria-label="Nome allenamento"
          defaultValue={workout.name}
          maxLength={100}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name && name !== workout.name) rename.mutate({ workoutId, name });
          }}
          className="w-full bg-transparent text-2xl font-bold text-slate-900 focus:outline-none"
        />

        {items.map((item, index) => (
          <WorkoutExerciseCard
            key={item.id}
            workoutId={workoutId}
            item={item}
            actions={actionsFor(item, index)}
            onShowExercise={() => setDetailId(item.exercise.id)}
            onPickRest={() => setRestFor(item.id)}
          />
        ))}

        <button type="button" className="btn-secondary w-full text-sky-600" onClick={() => setPicker({ mode: "add" })}>
          + Aggiungi esercizio
        </button>
        <button type="button" className="btn-ghost w-full text-red-600" onClick={handleCancel} disabled={cancel.isPending}>
          Annulla allenamento
        </button>
      </div>

      {picker && (
        <ExercisePicker
          title={picker.mode === "replace" ? "Sostituisci esercizio" : "Aggiungi esercizi"}
          multiple={picker.mode === "add"}
          onPick={pickExercises}
          onClose={() => setPicker(null)}
        />
      )}
      {restItem && (
        <RestPicker
          value={restItem.rest_seconds}
          onClose={() => setRestFor(null)}
          onChange={(seconds) => {
            patchExercise.mutate({ workoutId, id: restItem.id, rest_seconds: seconds });
            setRestFor(null);
          }}
        />
      )}
      {manualRest && (
        <RestPicker
          title="Avvia timer"
          value={90}
          onClose={() => setManualRest(false)}
          onChange={(seconds) => {
            if (seconds > 0) rest.mutate({ workoutId, action: { start_s: seconds } });
            setManualRest(false);
          }}
        />
      )}
      {detailId !== null && <ExerciseDetailSheet exerciseId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

export default WorkoutPage;
