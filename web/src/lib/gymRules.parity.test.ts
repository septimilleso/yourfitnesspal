import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { SetValues, Tracking } from "../api/gym";
import { formatSet, normalizeSupersets as webNormalizeSupersets } from "./gym";
import {
  type DiffExercise,
  type ExerciseProgress,
  NoRestTimerError,
  type StateWorkout,
  canonicalWorkout,
  clampTimes,
  exercisePrefill,
  finishPrune,
  finishProblem,
  formatSetText,
  nextSetValues,
  normalizeSupersets,
  restAction,
  restAfterCompletion,
  roundKg,
  sameContent,
  setProblem,
  templateDiff,
  trackingReset,
} from "./gymRules";

// Stesse fixture che legge pytest (api/tests/test_gym_parity.py): ogni caso gira qui.
interface Case {
  fn: string;
  name: string;
  input: unknown;
  expected: unknown;
}

const CASES = JSON.parse(
  readFileSync(resolve(process.cwd(), "../api/tests/fixtures/gym_parity.json"), "utf-8"),
) as Case[];

// Nella fixture un set è una tupla (peso, ripetizioni, durata); nel TS è un oggetto SetValues.
type Tuple = [number | null, number | null, number | null];

function toSet(tuple: Tuple): SetValues {
  return { weight_kg: tuple[0], reps: tuple[1], duration_s: tuple[2] };
}

function toTuple(set: SetValues): Tuple {
  return [set.weight_kg, set.reps, set.duration_s];
}

function optionalSet(tuple: Tuple | null): SetValues | null {
  return tuple === null ? null : toSet(tuple);
}

interface DiffFixture extends Omit<DiffExercise, "sets"> {
  sets: Tuple[];
}

function toDiff(exercise: DiffFixture): DiffExercise {
  return { ...exercise, sets: exercise.sets.map(toSet) };
}

function args<T>(input: unknown): T {
  return input as T;
}

type Runner = (input: unknown) => unknown;

// Un runner per ogni `fn` della fixture: traduce gli argomenti JSON e confronta l'uscita.
const RUNNERS: Record<string, Runner> = {
  normalize_supersets: (input) =>
    normalizeSupersets(args<{ groups: (number | null)[] }>(input).groups),

  set_problem: (input) => {
    const a = args<{
      tracking: Tracking;
      weight_kg: number | null;
      reps: number | null;
      duration_s: number | null;
    }>(input);
    return setProblem(a.tracking, a.weight_kg, a.reps, a.duration_s);
  },

  rest_after_completion: (input) => {
    const a = args<{ exercises: ExerciseProgress[]; index: number; position: number }>(input);
    return restAfterCompletion(a.exercises, a.index, a.position);
  },

  template_diff: (input) => {
    const a = args<{ template: DiffFixture[]; workout: DiffFixture[] }>(input);
    return templateDiff(a.template.map(toDiff), a.workout.map(toDiff));
  },

  format_set: (input) => {
    const a = args<{ tracking: Tracking; values: Tuple }>(input);
    return formatSetText(a.tracking, toSet(a.values));
  },

  next_set_values: (input) => {
    const a = args<{ last: Tuple | null; previous_first: Tuple | null }>(input);
    return toTuple(nextSetValues(optionalSet(a.last), optionalSet(a.previous_first)));
  },

  exercise_prefill: (input) => {
    const a = args<{ previous_rest: number | null; previous_sets: Tuple[] }>(input);
    const result = exercisePrefill(a.previous_rest, a.previous_sets.map(toSet));
    return { rest_seconds: result.rest_seconds, sets: result.sets.map(toTuple) };
  },

  tracking_reset: (input) => {
    const a = args<{ tracking: Tracking; sets: Parameters<typeof trackingReset>[1] }>(input);
    return trackingReset(a.tracking, a.sets);
  },

  rest_action: (input) => {
    const a = args<{
      now: string;
      ends_at: string | null;
      total_s: number | null;
      start_s: number | null;
      delta_s: number | null;
      skip: boolean;
    }>(input);
    try {
      return restAction(Date.parse(a.now), a.ends_at, a.total_s, {
        startS: a.start_s,
        deltaS: a.delta_s,
        skip: a.skip,
      });
    } catch (error) {
      if (error instanceof NoRestTimerError) return { error: error.message };
      throw error;
    }
  },

  finish_problem: (input) => {
    const a = args<{ completed: boolean[]; discard_incomplete: boolean }>(input);
    return finishProblem(a.completed, a.discard_incomplete);
  },

  finish_prune: (input) => finishPrune(args<{ completed: boolean[][] }>(input).completed),

  canonical_workout: (input) =>
    canonicalWorkout(args<{ workout: StateWorkout }>(input).workout),

  same_content: (input) => {
    const a = args<{ a: StateWorkout; b: StateWorkout }>(input);
    return sameContent(a.a, a.b);
  },

  clamp_times: (input) => {
    const a = args<{ workout: StateWorkout; now: string }>(input);
    return clampTimes(a.workout, Date.parse(a.now));
  },
};

describe("gym rules parity with api/app/services/gym_rules.py", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const run = RUNNERS[c.fn];
    if (run === undefined) throw new Error(`nessuna implementazione TS per ${c.fn}`);
    expect(run(c.input)).toEqual(c.expected);
  });

  it("ha un runner per ogni fn della fixture e nessun runner in più", () => {
    expect(new Set(Object.keys(RUNNERS))).toEqual(new Set(CASES.map((c) => c.fn)));
  });
});

describe("helpers condivisi con web/src/lib/gym.ts", () => {
  const casesOf = (fn: string) => CASES.filter((c) => c.fn === fn);

  it.each(casesOf("format_set").map((c) => [c.name, c] as const))(
    "formatSetText dà lo stesso testo di formatSet: %s",
    (_name, c) => {
      const a = args<{ tracking: Tracking; values: Tuple }>(c.input);
      expect(formatSetText(a.tracking, toSet(a.values))).toBe(formatSet(a.tracking, toSet(a.values)));
    },
  );

  it.each(casesOf("normalize_supersets").map((c) => [c.name, c] as const))(
    "normalizeSupersets dà lo stesso risultato di gym.ts: %s",
    (_name, c) => {
      const a = args<{ groups: (number | null)[] }>(c.input);
      expect(normalizeSupersets(a.groups)).toEqual(webNormalizeSupersets(a.groups));
    },
  );
});

describe("peso a 2 decimali", () => {
  it("arrotonda half-up sul decimale del float", () => {
    expect(roundKg(80.125)).toBe(80.13);
    expect(roundKg(2.675)).toBe(2.68);
    expect(roundKg(37.5)).toBe(37.5);
    expect(roundKg(null)).toBeNull();
  });

  it("canonicalWorkout arrotonda il peso, come lo schema del PUT prima di canonical", () => {
    const workout = (weight: number): StateWorkout => ({
      name: "Push",
      template_id: null,
      status: "in_progress",
      started_at: "2026-10-14T09:00:00+00:00",
      finished_at: null,
      rest_ends_at: null,
      rest_total_s: null,
      exercises: [
        {
          exercise_id: 1,
          rest_seconds: 90,
          superset_group: null,
          note: null,
          sets: [
            {
              weight_kg: weight,
              reps: 8,
              duration_s: null,
              completed_at: "2026-10-14T09:05:00+00:00",
            },
          ],
        },
      ],
    });
    expect(canonicalWorkout(workout(80.125)).exercises[0].sets[0].weight_kg).toBe(80.13);
    expect(sameContent(workout(80.125), workout(80.13))).toBe(true);
  });
});
