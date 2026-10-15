import { describe, expect, it } from "vitest";

import type { Exercise, OfflineSnapshot, SetValues, Template, Tracking, Workout } from "../api/gym";
import {
  type ExerciseRef,
  type SessionAction,
  type SessionDeps,
  type SessionExercise,
  type SessionResult,
  type SessionSet,
  type SessionWorkout,
  previousAndMax,
  previousFirst,
  reduceSession,
  startEmpty,
  startFromTemplate,
} from "./gymSession";
import { formatSetText, isoOffset } from "./gymRules";

const NOW = Date.parse("2026-10-14T10:00:00Z");
const LAYOUT_INVALID = "layout must list every exercise once";

function deps(now = NOW, uuid = () => "new-1"): SessionDeps {
  return { now, uuid };
}

function run(state: SessionWorkout, action: SessionAction, options: SessionDeps = deps()): SessionResult {
  return reduceSession(state, action, options);
}

/** Stato dopo un'azione riuscita; fallisce il test se l'azione è rifiutata. */
function applied(result: SessionResult): SessionWorkout {
  if (!result.ok) throw new Error(`azione rifiutata: ${result.error}`);
  return result.state;
}

/** Azione rifiutata: stesso messaggio del server e stato invariato, stesso riferimento. */
function expectRejected(result: SessionResult, error: string, state: SessionWorkout): void {
  expect(result.ok).toBe(false);
  expect(result.ok ? null : result.error).toBe(error);
  expect(result.state).toBe(state);
}

function exerciseOf(id: number, name: string, tracking: Tracking = "weight_reps"): Exercise {
  return {
    id,
    name,
    equipment: null,
    primary_muscles: [],
    secondary_muscles: [],
    category: null,
    tracking,
    custom: false,
  };
}

function refOf(id: number, name: string, tracking: Tracking = "weight_reps"): ExerciseRef {
  return { id, name, tracking };
}

function set(
  uuid: string,
  values: { weight_kg?: number | null; reps?: number | null; duration_s?: number | null } = {},
  completedAt: string | null = null,
): SessionSet {
  return {
    uuid,
    id: null,
    weight_kg: values.weight_kg ?? null,
    reps: values.reps ?? null,
    duration_s: values.duration_s ?? null,
    completed_at: completedAt,
  };
}

function exercise(uuid: string, overrides: Partial<SessionExercise> = {}): SessionExercise {
  return {
    uuid,
    id: null,
    exercise_id: 1,
    name: uuid,
    tracking: "weight_reps",
    rest_seconds: 90,
    superset_group: null,
    note: null,
    sets: [],
    ...overrides,
  };
}

function workout(exercises: SessionExercise[], overrides: Partial<SessionWorkout> = {}): SessionWorkout {
  return {
    uuid: "w1",
    id: null,
    version: null,
    name: "Allenamento",
    template_id: null,
    status: "in_progress",
    started_at: isoOffset(NOW - 600_000),
    finished_at: null,
    rest_ends_at: null,
    rest_total_s: null,
    exercises,
    ...overrides,
  };
}

/** Snapshot con una voce per esercizio; `previous` e `max` sono per posizione. */
function snapshotOf(entries: OfflineSnapshot["exercises"]): OfflineSnapshot {
  return { server_now: isoOffset(NOW), exercises: entries };
}

function snapshotEntry(
  exercise: Exercise,
  rest: number | null,
  previous: SetValues[],
  max: SetValues[],
): OfflineSnapshot["exercises"][number] {
  return { exercise, rest_seconds: rest, previous, max };
}

function values(weight: number | null, reps: number | null, duration: number | null = null): SetValues {
  return { weight_kg: weight, reps, duration_s: duration };
}

/** `WorkoutOut` del server con un solo esercizio: serve a Precedente e Max di R13. */
function serverWorkout(sets: Workout["exercises"][number]["sets"]): Workout {
  return {
    id: 5,
    uuid: "w1",
    version: 2,
    name: "Allenamento",
    template_id: null,
    status: "in_progress",
    started_at: isoOffset(NOW - 600_000),
    finished_at: null,
    rest_ends_at: null,
    rest_total_s: null,
    server_now: isoOffset(NOW),
    exercises: [
      { id: 1, uuid: "ea", exercise: exerciseOf(10, "Panca"), rest_seconds: 90, superset_group: null, note: null, sets },
    ],
    template_diff: [],
  };
}

function setOf(state: SessionWorkout, exerciseUuid: string, index: number): SessionSet {
  const found = state.exercises.find((item) => item.uuid === exerciseUuid);
  if (!found) throw new Error(`esercizio ${exerciseUuid} assente`);
  return found.sets[index];
}

/** Uuid deterministici in ordine di chiamata: u1, u2, ... */
function counter(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `u${n}`;
  };
}

describe("startEmpty", () => {
  it("nome 'Allenamento GG/MM/AAAA' nel fuso dell'app (Europe/Rome): 23:30 UTC del 13 è già il 14 a Roma", () => {
    const ms = Date.parse("2026-10-13T23:30:00Z");

    const next = startEmpty({ now: ms, uuid: () => "w-new" });

    expect(next).toEqual({
      uuid: "w-new",
      id: null,
      version: null,
      name: "Allenamento 14/10/2026",
      template_id: null,
      status: "in_progress",
      started_at: isoOffset(ms),
      finished_at: null,
      rest_ends_at: null,
      rest_total_s: null,
      exercises: [],
    });
  });

  it("con un fuso esplicito il giorno è quello di quel fuso", () => {
    const ms = Date.parse("2026-10-13T23:30:00Z");

    expect(startEmpty({ now: ms, uuid: () => "w" }, "UTC").name).toBe("Allenamento 13/10/2026");
  });

  it("cambio d'ora di ottobre (fine ora legale 25/10/2026): il giorno cambia alla mezzanotte locale", () => {
    // 25/10 23:59:59 CET (ancora il 25) e 26/10 00:00 CET (il 26): il confine è a 23:00 UTC.
    expect(startEmpty({ now: Date.parse("2026-10-25T22:59:59Z"), uuid: () => "w" }).name).toBe("Allenamento 25/10/2026");
    expect(startEmpty({ now: Date.parse("2026-10-25T23:00:00Z"), uuid: () => "w" }).name).toBe("Allenamento 26/10/2026");
  });

  it("cambio d'ora di marzo (inizio ora legale 29/03/2026): il giorno cambia alla mezzanotte locale", () => {
    expect(startEmpty({ now: Date.parse("2026-03-28T22:59:59Z"), uuid: () => "w" }).name).toBe("Allenamento 28/03/2026");
    expect(startEmpty({ now: Date.parse("2026-03-28T23:00:00Z"), uuid: () => "w" }).name).toBe("Allenamento 29/03/2026");
  });
});

describe("startFromTemplate", () => {
  const template: Template = {
    id: 7,
    name: "Push",
    folder_id: null,
    last_used_at: null,
    exercises: [
      {
        id: 1,
        exercise: exerciseOf(10, "Panca"),
        rest_seconds: 120,
        superset_group: 3,
        note: "pausa lunga",
        sets: [values(80, 8), values(82.5, 6)],
      },
      {
        id: 2,
        exercise: exerciseOf(11, "Croci", "reps"),
        rest_seconds: 60,
        superset_group: 3,
        note: null,
        sets: [values(null, 12)],
      },
    ],
  };

  it("copia esercizi, serie, riposo, superserie e note nell'ordine, con uuid nuovi e nome del modello", () => {
    const result = startFromTemplate(template, { now: NOW, uuid: counter() });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.state;
    expect(next).toMatchObject({
      uuid: "u1",
      name: "Push",
      template_id: 7,
      status: "in_progress",
      started_at: isoOffset(NOW),
      finished_at: null,
    });
    expect(next.exercises).toHaveLength(2);
    expect(next.exercises[0]).toMatchObject({
      uuid: "u2",
      id: null,
      exercise_id: 10,
      name: "Panca",
      tracking: "weight_reps",
      rest_seconds: 120,
      superset_group: 3,
      note: "pausa lunga",
    });
    expect(next.exercises[0].sets).toEqual([
      { uuid: "u3", id: null, weight_kg: 80, reps: 8, duration_s: null, completed_at: null },
      { uuid: "u4", id: null, weight_kg: 82.5, reps: 6, duration_s: null, completed_at: null },
    ]);
    expect(next.exercises[1]).toMatchObject({ uuid: "u5", exercise_id: 11, tracking: "reps", rest_seconds: 60, note: null });
    expect(next.exercises[1].sets).toEqual([
      { uuid: "u6", id: null, weight_kg: null, reps: 12, duration_s: null, completed_at: null },
    ]);
  });

  it("più di 100 esercizi o più di 100 serie in un esercizio: 'Valori non validi'", () => {
    const manyExercises: Template = {
      ...template,
      exercises: Array.from({ length: 101 }, (_, i) => ({
        id: i + 1,
        exercise: exerciseOf(i + 1, `E${i}`),
        rest_seconds: 90,
        superset_group: null,
        note: null,
        sets: [values(1, 1)],
      })),
    };
    const manySets: Template = {
      ...template,
      exercises: [{ ...template.exercises[0], sets: Array.from({ length: 101 }, () => values(1, 1)) }],
    };

    expect(startFromTemplate(manyExercises, deps())).toEqual({ ok: false, error: "Valori non validi" });
    expect(startFromTemplate(manySets, deps())).toEqual({ ok: false, error: "Valori non validi" });
  });
});

describe("addExercises (C21)", () => {
  const panca = exerciseOf(10, "Panca");
  const snapshot = snapshotOf([
    snapshotEntry(panca, 120, [values(80, 8), values(80, 6)], [values(85, 8)]),
  ]);

  it("C21: due serie precompilate da Precedente, riposo dell'ultima volta, Precedente e max per serie", () => {
    const state = workout([]);

    const next = applied(run(state, { type: "addExercises", exercises: [refOf(10, "Panca")], snapshot }, deps(NOW, counter())));

    const added = next.exercises[0];
    expect(added).toMatchObject({ exercise_id: 10, name: "Panca", tracking: "weight_reps", rest_seconds: 120, superset_group: null, note: null });
    expect(added.sets.map((s) => [s.weight_kg, s.reps, s.completed_at])).toEqual([
      [80, 8, null],
      [80, 6, null],
    ]);

    const hints = previousAndMax({ workout: next, lastServer: null }, snapshot);
    const [first, second] = added.sets;
    expect(formatSetText("weight_reps", hints.get(first.uuid)!.previous!)).toBe("80 kg × 8");
    expect(formatSetText("weight_reps", hints.get(second.uuid)!.previous!)).toBe("80 kg × 6");
    expect(formatSetText("weight_reps", hints.get(first.uuid)!.max!)).toBe("85 kg × 8");
    expect(hints.get(second.uuid)).toEqual({ previous: values(80, 6), max: null });
  });

  it("esercizio fuori dallo snapshot: una serie vuota, 90 s, Precedente e Max assenti ('—')", () => {
    const state = workout([]);

    const next = applied(run(state, { type: "addExercises", exercises: [refOf(99, "Nuovo")], snapshot }));

    expect(next.exercises[0].rest_seconds).toBe(90);
    expect(next.exercises[0].sets.map((s) => [s.weight_kg, s.reps, s.duration_s])).toEqual([[null, null, null]]);
    const hints = previousAndMax({ workout: next, lastServer: null }, snapshot);
    expect(hints.get(next.exercises[0].sets[0].uuid)).toEqual({ previous: null, max: null });
  });

  it("senza snapshot il prefill è lo stesso di un esercizio fuori dallo snapshot", () => {
    const next = applied(run(workout([]), { type: "addExercises", exercises: [refOf(10, "Panca")], snapshot: null }));

    expect(next.exercises[0].rest_seconds).toBe(90);
    expect(next.exercises[0].sets).toHaveLength(1);
  });

  it("aggiunge più esercizi in ordine e in coda a quelli già presenti, con uuid esercizio prima delle serie", () => {
    const state = workout([exercise("A")]);
    const withIds: SessionDeps = { now: NOW, uuid: counter() };

    const next = applied(
      run(state, { type: "addExercises", exercises: [refOf(10, "Panca"), refOf(99, "Nuovo")], snapshot }, withIds),
    );

    expect(next.exercises.map((e) => e.name)).toEqual(["A", "Panca", "Nuovo"]);
    expect(next.exercises[1].uuid).toBe("u1");
    expect(next.exercises[1].sets.map((s) => s.uuid)).toEqual(["u2", "u3"]);
    expect(next.exercises[2].uuid).toBe("u4");
  });

  it("più di 100 esercizi in tutto: 'Valori non validi' e stato invariato", () => {
    const full = workout(Array.from({ length: 100 }, (_, i) => exercise(`E${i}`)));

    expectRejected(run(full, { type: "addExercises", exercises: [refOf(10, "Panca")], snapshot: null }), "Valori non validi", full);
  });

  it("Precedente con più di 100 serie non si può salvare: 'Valori non validi'", () => {
    const long = snapshotOf([
      snapshotEntry(panca, 90, Array.from({ length: 101 }, () => values(1, 1)), []),
    ]);
    const state = workout([]);

    expectRejected(run(state, { type: "addExercises", exercises: [refOf(10, "Panca")], snapshot: long }), "Valori non validi", state);
  });
});

describe("replaceExercise", () => {
  it("stesso tracking: cambia esercizio e tiene serie e completamenti", () => {
    const done = "2026-10-14T09:59:00+00:00";
    const state = workout([exercise("A", { exercise_id: 10, name: "Panca", sets: [set("a1", { weight_kg: 80, reps: 8 }, done)] })]);

    const next = applied(run(state, { type: "replaceExercise", exerciseUuid: "A", exercise: refOf(20, "Squat") }));

    expect(next.exercises[0]).toMatchObject({ exercise_id: 20, name: "Squat", tracking: "weight_reps" });
    expect(next.exercises[0].sets).toEqual(state.exercises[0].sets);
  });

  it("cambio di tracking: le serie perdono il completamento e i campi non usati si azzerano", () => {
    const state = workout([
      exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8, duration_s: 60 }, "2026-10-14T09:59:00+00:00")] }),
    ]);

    const next = applied(run(state, { type: "replaceExercise", exerciseUuid: "A", exercise: refOf(30, "Plank", "duration") }));

    expect(next.exercises[0]).toMatchObject({ exercise_id: 30, name: "Plank", tracking: "duration" });
    expect(setOf(next, "A", 0)).toEqual({ uuid: "a1", id: null, weight_kg: null, reps: null, duration_s: 60, completed_at: null });
  });

  it("stesso esercizio: nessuna modifica e stesso stato", () => {
    const state = workout([exercise("A", { exercise_id: 10, sets: [set("a1", { weight_kg: 80, reps: 8 })] })]);

    const result = run(state, { type: "replaceExercise", exerciseUuid: "A", exercise: refOf(10, "Panca") });

    expect(applied(result)).toBe(state);
  });
});

describe("setRest, setNote e rename", () => {
  it("setRest accetta 0 e 600 e rifiuta fuori dal limite di RestSeconds", () => {
    const state = workout([exercise("A")]);

    expect(applied(run(state, { type: "setRest", exerciseUuid: "A", seconds: 0 })).exercises[0].rest_seconds).toBe(0);
    expect(applied(run(state, { type: "setRest", exerciseUuid: "A", seconds: 600 })).exercises[0].rest_seconds).toBe(600);
    expectRejected(run(state, { type: "setRest", exerciseUuid: "A", seconds: 601 }), "Valori non validi", state);
    expectRejected(run(state, { type: "setRest", exerciseUuid: "A", seconds: -1 }), "Valori non validi", state);
    expectRejected(run(state, { type: "setRest", exerciseUuid: "A", seconds: 1.5 }), "Valori non validi", state);
  });

  it("setNote: vuota diventa null; massimo 500 caratteri contati come code point", () => {
    const state = workout([exercise("A", { note: "vecchia" })]);

    expect(applied(run(state, { type: "setNote", exerciseUuid: "A", note: "" })).exercises[0].note).toBeNull();
    expect(applied(run(state, { type: "setNote", exerciseUuid: "A", note: "😀".repeat(500) })).exercises[0].note).toBe("😀".repeat(500));
    expectRejected(run(state, { type: "setNote", exerciseUuid: "A", note: "😀".repeat(501) }), "Valori non validi", state);
  });

  it("rename toglie gli spazi; vuoto o oltre 100 caratteri è 'Valori non validi'", () => {
    const state = workout([]);

    expect(applied(run(state, { type: "rename", name: "  Push  " })).name).toBe("Push");
    expect(applied(run(state, { type: "rename", name: "a".repeat(100) })).name).toBe("a".repeat(100));
    expectRejected(run(state, { type: "rename", name: "   " }), "Valori non validi", state);
    expectRejected(run(state, { type: "rename", name: "a".repeat(101) }), "Valori non validi", state);
  });

  it("rename toglie gli spazi come lo strip di pydantic: U+0085 da solo è vuoto, U+0085 davanti si toglie", () => {
    const state = workout([]);

    expectRejected(run(state, { type: "rename", name: "\u0085" }), "Valori non validi", state);
    expect(applied(run(state, { type: "rename", name: "\u0085a" })).name).toBe("a");
    expect(applied(run(state, { type: "rename", name: "\u001fPush\u001c" })).name).toBe("Push");
  });
});

describe("setLayout", () => {
  it("riordina gli esercizi e rinumera le superserie come set_layout", () => {
    const state = workout([exercise("A"), exercise("B"), exercise("C")]);

    const next = applied(
      run(state, {
        type: "setLayout",
        layout: [
          { exerciseUuid: "C", superset_group: 2 },
          { exerciseUuid: "A", superset_group: 2 },
          { exerciseUuid: "B", superset_group: null },
        ],
      }),
    );

    expect(next.exercises.map((e) => [e.uuid, e.superset_group])).toEqual([
      ["C", 1],
      ["A", 1],
      ["B", null],
    ]);
  });

  it("gruppi diversi restano separati: [5,5,9,9] diventa [1,1,2,2]", () => {
    const state = workout([exercise("A", { superset_group: 5 }), exercise("B", { superset_group: 5 }), exercise("C", { superset_group: 9 }), exercise("D", { superset_group: 9 })]);

    const next = applied(
      run(state, {
        type: "setLayout",
        layout: ["A", "B", "C", "D"].map((exerciseUuid) => ({ exerciseUuid, superset_group: state.exercises.find((e) => e.uuid === exerciseUuid)!.superset_group })),
      }),
    );

    expect(next.exercises.map((e) => e.superset_group)).toEqual([1, 1, 2, 2]);
  });

  it("un esercizio mancante, doppio o sconosciuto: errore del server e stato invariato", () => {
    const state = workout([exercise("A"), exercise("B")]);

    expectRejected(run(state, { type: "setLayout", layout: [{ exerciseUuid: "A", superset_group: null }] }), LAYOUT_INVALID, state);
    expectRejected(
      run(state, {
        type: "setLayout",
        layout: [
          { exerciseUuid: "A", superset_group: null },
          { exerciseUuid: "A", superset_group: null },
        ],
      }),
      LAYOUT_INVALID,
      state,
    );
    expectRejected(
      run(state, {
        type: "setLayout",
        layout: [
          { exerciseUuid: "A", superset_group: null },
          { exerciseUuid: "X", superset_group: null },
        ],
      }),
      LAYOUT_INVALID,
      state,
    );
  });
});

describe("removeExercise", () => {
  it("toglie l'esercizio, mantiene l'ordine e rinumera le superserie (un solo membro è null)", () => {
    const state = workout([
      exercise("A", { superset_group: 1 }),
      exercise("B", { superset_group: 1 }),
      exercise("C", { superset_group: null }),
    ]);

    const next = applied(run(state, { type: "removeExercise", exerciseUuid: "B" }));

    expect(next.exercises.map((e) => [e.uuid, e.superset_group])).toEqual([
      ["A", null],
      ["C", null],
    ]);
  });

  it("esercizio sconosciuto: 'exercise not found' e stato invariato", () => {
    const state = workout([exercise("A")]);

    expectRejected(run(state, { type: "removeExercise", exerciseUuid: "X" }), "exercise not found", state);
  });
});

describe("finish (C31, regole di fine)", () => {
  const withDone = (): SessionWorkout =>
    workout(
      [
        exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 }, "2026-10-14T09:50:00+00:00"), set("a2", { weight_kg: 80, reps: 6 })] }),
        exercise("B", { sets: [set("b1", { weight_kg: 40, reps: 10 })] }),
        exercise("C", { sets: [set("c1", { weight_kg: 20, reps: 12 }, "2026-10-14T09:55:00+00:00")] }),
      ],
      { rest_ends_at: isoOffset(NOW + 60_000), rest_total_s: 60 },
    );

  it("nessuna serie fatta: 'empty_workout' e stato invariato, anche senza esercizi", () => {
    const state = workout([exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 })] })]);
    const empty = workout([]);

    expectRejected(run(state, { type: "finish", discardIncomplete: false }), "empty_workout", state);
    expectRejected(run(state, { type: "finish", discardIncomplete: true }), "empty_workout", state);
    expectRejected(run(empty, { type: "finish", discardIncomplete: true }), "empty_workout", empty);
  });

  it("serie non fatte senza conferma: 'incomplete_sets' e stato invariato", () => {
    const state = withDone();

    expectRejected(run(state, { type: "finish", discardIncomplete: false }), "incomplete_sets", state);
  });

  it("con conferma: tiene solo le serie fatte, toglie gli esercizi senza serie fatte, azzera il riposo", () => {
    const state = withDone();

    const next = applied(run(state, { type: "finish", discardIncomplete: true }, deps(NOW)));

    expect(next.status).toBe("finished");
    expect(next.finished_at).toBe(isoOffset(NOW));
    expect(next.rest_ends_at).toBeNull();
    expect(next.rest_total_s).toBeNull();
    expect(next.exercises.map((e) => [e.uuid, e.sets.map((s) => s.uuid)])).toEqual([
      ["A", ["a1"]],
      ["C", ["c1"]],
    ]);
  });

  it("con tutte le serie fatte la fine riesce anche senza conferma e tiene tutto", () => {
    const state = workout([
      exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 }, "2026-10-14T09:50:00+00:00")] }),
    ]);

    const next = applied(run(state, { type: "finish", discardIncomplete: false }));

    expect(next.status).toBe("finished");
    expect(next.exercises[0].sets.map((s) => s.uuid)).toEqual(["a1"]);
  });

  it("superserie con un partner scartato: dopo la fine il membro rimasto non è più in superserie", () => {
    const state = workout([
      exercise("A", { superset_group: 1, sets: [set("a1", { weight_kg: 80, reps: 8 }, "2026-10-14T09:50:00+00:00")] }),
      exercise("B", { superset_group: 2, sets: [set("b1", { weight_kg: 40, reps: 10 })] }),
      exercise("C", { superset_group: 2, sets: [set("c1", { weight_kg: 20, reps: 12 }, "2026-10-14T09:55:00+00:00")] }),
    ]);

    const next = applied(run(state, { type: "finish", discardIncomplete: true }));

    expect(next.exercises.map((e) => [e.uuid, e.superset_group])).toEqual([
      ["A", null],
      ["C", null],
    ]);
  });

  it("già finito: 'workout is not in progress' e stato invariato", () => {
    const finished = workout([exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 }, "2026-10-14T09:50:00+00:00")] })], {
      status: "finished",
      finished_at: isoOffset(NOW - 500),
    });

    expectRejected(run(finished, { type: "finish", discardIncomplete: true }), "workout is not in progress", finished);
  });
});

describe("previousAndMax (R13)", () => {
  const snapshot = snapshotOf([
    snapshotEntry(exerciseOf(10, "Panca"), 90, [values(70, 5), values(60, 5)], [values(75, 5), values(65, 5)]),
  ]);
  const local = workout([
    exercise("A", { exercise_id: 10, sets: [set("a1"), set("a2")] }),
    exercise("B", { exercise_id: 99, sets: [set("b1")] }),
  ]);

  it("la risposta del server per l'allenamento vince sullo snapshot, per uuid della serie", () => {
    const lastServer = serverWorkout([
      {
        id: 1,
        uuid: "a1",
        weight_kg: null,
        reps: null,
        duration_s: null,
        completed_at: null,
        previous: values(80, 8),
        max_set: values(85, 8),
      },
    ]);

    const hints = previousAndMax({ workout: local, lastServer }, snapshot);

    expect(hints.get("a1")).toEqual({ previous: values(80, 8), max: values(85, 8) });
  });

  it("senza risposta del server, o per una serie che il server non conosce, valgono le liste dello snapshot per posizione", () => {
    const hints = previousAndMax({ workout: local, lastServer: null }, snapshot);

    expect(hints.get("a1")).toEqual({ previous: values(70, 5), max: values(75, 5) });
    expect(hints.get("a2")).toEqual({ previous: values(60, 5), max: values(65, 5) });
  });

  it("un esercizio fuori dallo snapshot non ha Precedente né max", () => {
    const hints = previousAndMax({ workout: local, lastServer: null }, snapshot);

    expect(hints.get("b1")).toEqual({ previous: null, max: null });
  });

  it("senza snapshot niente Precedente, ma la risposta del server resta valida", () => {
    const lastServer = serverWorkout([
      { id: 1, uuid: "a1", weight_kg: null, reps: null, duration_s: null, completed_at: null, previous: values(80, 8), max_set: null },
    ]);

    const hints = previousAndMax({ workout: local, lastServer }, null);

    expect(hints.get("a1")).toEqual({ previous: values(80, 8), max: null });
    expect(hints.get("a2")).toEqual({ previous: null, max: null });
  });
});

describe("previousAndMax: la risposta del server vale solo nello stesso esercizio e alla stessa posizione", () => {
  const snapshot = snapshotOf([
    snapshotEntry(exerciseOf(10, "Panca"), 90, [values(70, 5), values(60, 5)], [values(75, 5), values(65, 5)]),
    snapshotEntry(exerciseOf(20, "Squat"), 120, [values(100, 5)], [values(110, 5)]),
  ]);
  // Il server ha a1 in posizione 0 e a2 in posizione 1, entrambe di Panca (id 10).
  const lastServer = serverWorkout([
    { id: 1, uuid: "a1", weight_kg: null, reps: null, duration_s: null, completed_at: null, previous: values(80, 8), max_set: values(85, 8) },
    { id: 2, uuid: "a2", weight_kg: null, reps: null, duration_s: null, completed_at: null, previous: values(60, 5), max_set: values(65, 5) },
  ]);

  it("stesso esercizio e stessa posizione: vale la risposta del server anche se lo snapshot dice altro", () => {
    const state = workout([exercise("A", { exercise_id: 10, sets: [set("a1"), set("a2")] })]);

    const hints = previousAndMax({ workout: state, lastServer }, snapshot);

    expect(hints.get("a1")).toEqual({ previous: values(80, 8), max: values(85, 8) });
    expect(hints.get("a2")).toEqual({ previous: values(60, 5), max: values(65, 5) });
  });

  it("replaceExercise da Panca a Squat con lo stesso tracking: a1 non prende il Precedente di Panca", () => {
    const state = workout([exercise("A", { exercise_id: 10, name: "Panca", sets: [set("a1"), set("a2")] })]);

    const replaced = applied(run(state, { type: "replaceExercise", exerciseUuid: "A", exercise: refOf(20, "Squat") }));
    const hints = previousAndMax({ workout: replaced, lastServer }, snapshot);

    expect(hints.get("a1")).toEqual({ previous: values(100, 5), max: values(110, 5) });
    expect(hints.get("a2")).toEqual({ previous: null, max: null });
  });

  it("replaceExercise con tracking diverso fuori dallo snapshot: nessun Precedente né max dalla risposta del server", () => {
    const state = workout([exercise("A", { exercise_id: 10, sets: [set("a1", { weight_kg: 80, reps: 8 })] })]);

    const replaced = applied(run(state, { type: "replaceExercise", exerciseUuid: "A", exercise: refOf(30, "Plank", "duration") }));
    const hints = previousAndMax({ workout: replaced, lastServer }, snapshot);

    expect(hints.get("a1")).toEqual({ previous: null, max: null });
  });

  it("deleteSet della prima serie: la seconda, ora in posizione 0, prende lo snapshot della posizione 0", () => {
    const state = workout([exercise("A", { exercise_id: 10, sets: [set("a1"), set("a2")] })]);

    const afterDelete = applied(run(state, { type: "deleteSet", setUuid: "a1" }));
    const hints = previousAndMax({ workout: afterDelete, lastServer }, snapshot);

    expect(hints.get("a2")).toEqual({ previous: values(70, 5), max: values(75, 5) });
  });
});

describe("previousFirst (prefill di addSet)", () => {
  const snapshot = snapshotOf([
    snapshotEntry(exerciseOf(10, "Panca"), 120, [values(80, 8), values(80, 6)], [values(85, 8)]),
    snapshotEntry(exerciseOf(11, "Vuota"), null, [], []),
  ]);

  it("è la prima serie di Precedente dell'esercizio; null fuori dallo snapshot, senza Precedente o senza snapshot", () => {
    expect(previousFirst(10, snapshot)).toEqual(values(80, 8));
    expect(previousFirst(11, snapshot)).toBeNull();
    expect(previousFirst(99, snapshot)).toBeNull();
    expect(previousFirst(10, null)).toBeNull();
  });

  it("addSet senza serie usa la prima di Precedente restituita da previousFirst", () => {
    const state = workout([exercise("A", { exercise_id: 10 })]);

    const next = applied(
      run(state, { type: "addSet", exerciseUuid: "A", previousFirst: previousFirst(10, snapshot) }),
    );

    expect(next.exercises[0].sets[0]).toMatchObject({ weight_kg: 80, reps: 8, completed_at: null });
  });
});
