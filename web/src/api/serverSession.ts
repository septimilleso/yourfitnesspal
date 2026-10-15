import type { WorkoutExercise, Workout } from "./gym";
import {
  gymApi,
  useCancelWorkout,
  useFinishWorkout,
  useLiveMutation,
} from "./gym";
import { liveErrorMessage } from "../lib/gym";
import { keyOf, type LiveSession } from "../lib/liveSession";

/** Sessione del web: ogni operazione è una chiamata a `gymApi` con gli id del server, ricavati dall'uuid. */
export function useServerSession(workout: Workout): LiveSession {
  const workoutId = workout.id;
  const renameMutation = useLiveMutation(gymApi.renameWorkout);
  const addExerciseMutation = useLiveMutation(gymApi.addExercise);
  const patchExerciseMutation = useLiveMutation(gymApi.patchExercise);
  const removeExerciseMutation = useLiveMutation(gymApi.removeExercise);
  const setLayoutMutation = useLiveMutation(gymApi.setLayout);
  const addSetMutation = useLiveMutation(gymApi.addSet);
  const patchSetMutation = useLiveMutation(gymApi.patchSet);
  const deleteSetMutation = useLiveMutation(gymApi.deleteSet);
  const completeSetMutation = useLiveMutation(gymApi.completeSet);
  const uncompleteSetMutation = useLiveMutation(gymApi.uncompleteSet);
  const restMutation = useLiveMutation(gymApi.rest);
  const finishMutation = useFinishWorkout();
  const cancelMutation = useCancelWorkout();

  // Le chiavi della UI sono uuid (o id di ripiego): qui si ritrovano gli id numerici del server.
  // Una chiave che non c'è più nell'allenamento non invia nulla.
  function exerciseWithKey(exerciseUuid: string): WorkoutExercise | undefined {
    return workout.exercises.find((exercise) => keyOf(exercise) === exerciseUuid);
  }

  function setIdWithKey(setUuid: string): number | undefined {
    for (const exercise of workout.exercises) {
      const set = exercise.sets.find((candidate) => keyOf(candidate) === setUuid);
      if (set) return set.id;
    }
    return undefined;
  }

  return {
    workout,
    isFinishing: finishMutation.isPending,
    isCancelling: cancelMutation.isPending,

    rename(name) {
      renameMutation.mutate({ workoutId, name });
    },
    addExercises(exercises) {
      for (const exercise of exercises) addExerciseMutation.mutate({ workoutId, exerciseId: exercise.id });
    },
    replaceExercise(exerciseUuid, exercise) {
      const item = exerciseWithKey(exerciseUuid);
      if (item) patchExerciseMutation.mutate({ workoutId, id: item.id, exercise_id: exercise.id });
    },
    removeExercise(exerciseUuid) {
      const item = exerciseWithKey(exerciseUuid);
      if (item) removeExerciseMutation.mutate({ workoutId, id: item.id });
    },
    setNote(exerciseUuid, note) {
      const item = exerciseWithKey(exerciseUuid);
      if (item) patchExerciseMutation.mutate({ workoutId, id: item.id, note });
    },
    setRest(exerciseUuid, seconds) {
      const item = exerciseWithKey(exerciseUuid);
      if (item) patchExerciseMutation.mutate({ workoutId, id: item.id, rest_seconds: seconds });
    },
    setLayout(layout) {
      const items = layout.flatMap((entry) => {
        const item = exerciseWithKey(entry.exerciseUuid);
        return item ? [{ id: item.id, superset_group: entry.superset_group }] : [];
      });
      setLayoutMutation.mutate({ workoutId, items });
    },
    addSet(exerciseUuid) {
      const item = exerciseWithKey(exerciseUuid);
      if (item) addSetMutation.mutate({ workoutId, exerciseId: item.id });
    },
    patchSet(setUuid, values) {
      const id = setIdWithKey(setUuid);
      if (id !== undefined) patchSetMutation.mutate({ workoutId, id, values });
    },
    completeSet(setUuid, values) {
      const id = setIdWithKey(setUuid);
      if (id !== undefined) completeSetMutation.mutate({ workoutId, id, values });
    },
    uncompleteSet(setUuid) {
      const id = setIdWithKey(setUuid);
      if (id !== undefined) uncompleteSetMutation.mutate({ workoutId, id });
    },
    deleteSet(setUuid) {
      const id = setIdWithKey(setUuid);
      if (id !== undefined) deleteSetMutation.mutate({ workoutId, id });
    },
    restStart(seconds) {
      restMutation.mutate({ workoutId, action: { start_s: seconds } });
    },
    restDelta(seconds) {
      restMutation.mutate({ workoutId, action: { delta_s: seconds } });
    },
    restSkip() {
      restMutation.mutate({ workoutId, action: { skip: true } });
    },
    finish(discardIncomplete, callbacks) {
      finishMutation.mutate(
        { workoutId, discardIncomplete },
        {
          onSuccess: (finished) => callbacks.onSuccess({ id: finished.id, uuid: keyOf(workout) }),
          onError: (error) => callbacks.onError(liveErrorMessage(error)),
        },
      );
    },
    cancel(callbacks) {
      cancelMutation.mutate(workoutId, {
        onSuccess: () => callbacks.onSuccess(),
        onError: (error) => callbacks.onError(liveErrorMessage(error)),
      });
    },
  };
}
