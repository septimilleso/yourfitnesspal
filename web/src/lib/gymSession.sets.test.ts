import { describe, expect, it } from "vitest";

import {
  type SessionAction,
  type SessionDeps,
  type SessionExercise,
  type SessionResult,
  type SessionSet,
  type SessionWorkout,
  reduceSession,
} from "./gymSession";
import { isoOffset } from "./gymRules";

const NOW = Date.parse("2026-10-14T10:00:00Z");

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

function setOf(state: SessionWorkout, exerciseUuid: string, index: number): SessionSet {
  const found = state.exercises.find((item) => item.uuid === exerciseUuid);
  if (!found) throw new Error(`esercizio ${exerciseUuid} assente`);
  return found.sets[index];
}

describe("completeSet e riposo", () => {
  it("completa la serie con i valori e avvia il riposo dell'esercizio", () => {
    const state = workout([exercise("A", { rest_seconds: 90, sets: [set("a1")] })]);

    const next = applied(
      run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80, reps: 8, duration_s: null } }),
    );

    expect(setOf(next, "A", 0)).toMatchObject({ weight_kg: 80, reps: 8, completed_at: isoOffset(NOW) });
    expect(next.rest_total_s).toBe(90);
    expect(next.rest_ends_at).toBe(isoOffset(NOW + 90_000));
  });

  it("C18: in superserie il riposo parte dopo il giro, con il riposo dell'ultimo esercizio", () => {
    const state = workout([
      exercise("A", { rest_seconds: 60, superset_group: 1, sets: [set("a1", { weight_kg: 80, reps: 8 })] }),
      exercise("B", { rest_seconds: 120, superset_group: 1, sets: [set("b1", { weight_kg: 40, reps: 10 })] }),
    ]);

    const afterA = applied(
      run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80, reps: 8, duration_s: null } }),
    );
    expect(afterA.rest_ends_at).toBeNull();
    expect(afterA.rest_total_s).toBeNull();

    const afterB = applied(
      run(afterA, { type: "completeSet", setUuid: "b1", values: { weight_kg: 40, reps: 10, duration_s: null } }),
    );
    expect(afterB.rest_total_s).toBe(120);
    expect(afterB.rest_ends_at).toBe(isoOffset(NOW + 120_000));
  });

  it("superserie: il riposo non parte se un tratto del giro manca ancora", () => {
    const state = workout([
      exercise("A", {
        rest_seconds: 60,
        superset_group: 1,
        sets: [set("a1", { weight_kg: 80, reps: 8 }), set("a2", { weight_kg: 80, reps: 8 })],
      }),
      exercise("B", {
        rest_seconds: 120,
        superset_group: 1,
        sets: [set("b1", { weight_kg: 40, reps: 10 }), set("b2", { weight_kg: 40, reps: 10 })],
      }),
    ]);

    const afterA1 = applied(run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80, reps: 8, duration_s: null } }));
    const afterB1 = applied(run(afterA1, { type: "completeSet", setUuid: "b1", values: { weight_kg: 40, reps: 10, duration_s: null } }));
    expect(afterB1.rest_total_s).toBe(120);

    // Giro 2: con A2 fatta ma B2 no, il giro non è chiuso e non parte un nuovo riposo.
    const afterA2 = applied(run(afterB1, { type: "completeSet", setUuid: "a2", values: { weight_kg: 80, reps: 8, duration_s: null } }));
    expect(afterA2.rest_total_s).toBe(120);
    expect(afterA2.rest_ends_at).toBe(afterB1.rest_ends_at);
  });

  it("riusa il riposo dell'esercizio fuori superserie e nessun timer con riposo 0", () => {
    const state = workout([exercise("A", { rest_seconds: 0, sets: [set("a1")] })]);

    const next = applied(run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80, reps: 8, duration_s: null } }));

    expect(next.rest_ends_at).toBeNull();
    expect(next.rest_total_s).toBeNull();
  });

  it("C19: ✓ senza kg rifiuta con 'weight and reps are required' e lascia la serie non fatta", () => {
    const state = workout([exercise("A", { sets: [set("a1", { reps: 8 })] })]);

    const result = run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: null, reps: 8, duration_s: null } });

    expectRejected(result, "weight and reps are required", state);
    expect(setOf(state, "A", 0).completed_at).toBeNull();
  });

  it("✓ senza ripetizioni e con tracking a durata danno gli errori del server", () => {
    const byReps = workout([exercise("A", { tracking: "weight_reps", sets: [set("a1")] })]);
    const repsOnly = workout([exercise("R", { tracking: "reps", sets: [set("r1")] })]);
    const duration = workout([exercise("D", { tracking: "duration", sets: [set("d1")] })]);

    expectRejected(
      run(byReps, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80, reps: null, duration_s: null } }),
      "weight and reps are required",
      byReps,
    );
    expectRejected(
      run(repsOnly, { type: "completeSet", setUuid: "r1", values: { weight_kg: null, reps: null, duration_s: null } }),
      "reps are required",
      repsOnly,
    );
    expectRejected(
      run(duration, { type: "completeSet", setUuid: "d1", values: { weight_kg: null, reps: null, duration_s: null } }),
      "duration is required",
      duration,
    );
  });

  it("arrotonda il peso a 2 decimali come il server", () => {
    const state = workout([exercise("A", { sets: [set("a1")] })]);

    const next = applied(run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80.125, reps: 8, duration_s: null } }));

    expect(setOf(next, "A", 0).weight_kg).toBe(80.13);
  });

  it("completare una serie già fatta aggiorna i valori senza far ripartire il riposo", () => {
    const state = workout(
      [exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 }, isoOffset(NOW - 1000))] })],
      { rest_ends_at: null, rest_total_s: null },
    );

    const next = applied(run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 82.5, reps: 8, duration_s: null } }));

    expect(setOf(next, "A", 0)).toMatchObject({ weight_kg: 82.5, completed_at: isoOffset(NOW - 1000) });
    expect(next.rest_ends_at).toBeNull();
  });
});

describe("patchSet e uncompleteSet", () => {
  it("una serie non fatta si modifica anche con valori incompleti", () => {
    const state = workout([exercise("A", { sets: [set("a1")] })]);

    const next = applied(run(state, { type: "patchSet", setUuid: "a1", values: { weight_kg: 80, reps: null, duration_s: null } }));

    expect(setOf(next, "A", 0)).toMatchObject({ weight_kg: 80, reps: null });
  });

  it("una serie fatta non accetta valori che il server rifiuterebbe", () => {
    const state = workout([exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 }, isoOffset(NOW - 1000))] })]);

    const result = run(state, { type: "patchSet", setUuid: "a1", values: { weight_kg: null, reps: 8, duration_s: null } });

    expectRejected(result, "weight and reps are required", state);
  });

  it("uncompleteSet toglie il completamento senza toccare il riposo", () => {
    const restEnds = isoOffset(NOW + 60_000);
    const state = workout(
      [exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 }, isoOffset(NOW - 1000))] })],
      { rest_ends_at: restEnds, rest_total_s: 60 },
    );

    const next = applied(run(state, { type: "uncompleteSet", setUuid: "a1" }));

    expect(setOf(next, "A", 0)).toMatchObject({ weight_kg: 80, reps: 8, completed_at: null });
    expect(next.rest_ends_at).toBe(restEnds);
    expect(next.rest_total_s).toBe(60);
  });
});

describe("riposo dall'orario iniettato (C23)", () => {
  it("restStart usa `now` e restDelta sposta la fine con lo stesso orologio", () => {
    const state = workout([exercise("A")]);

    const started = applied(run(state, { type: "restStart", seconds: 90 }, deps(NOW)));
    expect(started.rest_ends_at).toBe(isoOffset(NOW + 90_000));
    expect(started.rest_total_s).toBe(90);

    const extended = applied(run(started, { type: "restDelta", seconds: 15 }, deps(NOW + 30_000)));
    expect(extended.rest_ends_at).toBe(isoOffset(NOW + 105_000));
    expect(extended.rest_total_s).toBe(105);
  });

  it("restStart con un orologio diverso produce un'altra fine", () => {
    const state = workout([exercise("A")]);

    const next = applied(run(state, { type: "restStart", seconds: 90 }, deps(NOW + 60_000)));

    expect(next.rest_ends_at).toBe(isoOffset(NOW + 150_000));
  });

  it("il completamento usa l'orologio iniettato per l'orario e per la fine del riposo", () => {
    const state = workout([exercise("A", { rest_seconds: 45, sets: [set("a1")] })]);

    const next = applied(
      run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80, reps: 8, duration_s: null } }, deps(NOW + 5_000)),
    );

    expect(setOf(next, "A", 0).completed_at).toBe(isoOffset(NOW + 5_000));
    expect(next.rest_ends_at).toBe(isoOffset(NOW + 50_000));
  });

  it("restSkip azzera il riposo", () => {
    const state = workout([exercise("A")], { rest_ends_at: isoOffset(NOW + 60_000), rest_total_s: 60 });

    const next = applied(run(state, { type: "restSkip" }));

    expect(next.rest_ends_at).toBeNull();
    expect(next.rest_total_s).toBeNull();
  });

  it("un delta che porta la fine a `now` o prima chiude il riposo", () => {
    const state = workout([exercise("A")], { rest_ends_at: isoOffset(NOW + 30_000), rest_total_s: 30 });

    const next = applied(run(state, { type: "restDelta", seconds: -30 }, deps(NOW)));

    expect(next.rest_ends_at).toBeNull();
    expect(next.rest_total_s).toBeNull();
  });

  it("restDelta senza timer risponde 'no rest timer running' e lascia lo stato", () => {
    const state = workout([exercise("A")]);

    expectRejected(run(state, { type: "restDelta", seconds: 15 }), "no rest timer running", state);
  });

  it("restDelta su un riposo già scaduto risponde 'no rest timer running'", () => {
    const state = workout([exercise("A")], { rest_ends_at: isoOffset(NOW + 30_000), rest_total_s: 30 });

    expectRejected(run(state, { type: "restDelta", seconds: 15 }, deps(NOW + 60_000)), "no rest timer running", state);
  });

  it("durate fuori dal limite del server (1-600 s) sono rifiutate", () => {
    const state = workout([exercise("A")]);

    expectRejected(run(state, { type: "restStart", seconds: 0 }), "Valori non validi", state);
    expectRejected(run(state, { type: "restStart", seconds: 601 }), "Valori non validi", state);
  });
});

describe("addSet", () => {
  it("copia i valori dell'ultima serie con un nuovo uuid e non fatta", () => {
    const state = workout([
      exercise("A", {
        sets: [set("a1", { weight_kg: 80, reps: 8 }, isoOffset(NOW - 1000)), set("a2", { weight_kg: 82.5, reps: 6 })],
      }),
    ]);

    const next = applied(run(state, { type: "addSet", exerciseUuid: "A", previousFirst: null }, deps(NOW, () => "new-1")));

    const added = next.exercises[0].sets[2];
    expect(added).toEqual({ uuid: "new-1", id: null, weight_kg: 82.5, reps: 6, duration_s: null, completed_at: null });
  });

  it("senza serie usa la prima di Precedente", () => {
    const state = workout([exercise("A")]);

    const next = applied(
      run(state, { type: "addSet", exerciseUuid: "A", previousFirst: { weight_kg: 70, reps: 10, duration_s: null } }),
    );

    expect(next.exercises[0].sets[0]).toMatchObject({ weight_kg: 70, reps: 10, completed_at: null });
  });

  it("senza serie e senza Precedente aggiunge una serie vuota", () => {
    const state = workout([exercise("A")]);

    const next = applied(run(state, { type: "addSet", exerciseUuid: "A", previousFirst: null }));

    expect(next.exercises[0].sets[0]).toMatchObject({ weight_kg: null, reps: null, duration_s: null, completed_at: null });
  });
});

describe("deleteSet", () => {
  it("toglie la serie e rinumera le rimanenti nell'ordine", () => {
    const state = workout([
      exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 }), set("a2", { weight_kg: 81, reps: 8 }), set("a3", { weight_kg: 82, reps: 8 })] }),
    ]);

    const next = applied(run(state, { type: "deleteSet", setUuid: "a2" }));

    expect(next.exercises[0].sets.map((s) => s.uuid)).toEqual(["a1", "a3"]);
    expect(next.exercises[0].sets[1].weight_kg).toBe(82);
  });

  it("rinumerazione: il giro di superserie usa le posizioni nuove", () => {
    // A ha due serie, la prima fatta. Dopo averla tolta, la rimanente è in posizione 0 e non è fatta.
    // Completare la prima di B non deve far partire il riposo: A non ha ancora fatto il suo tratto.
    const state = workout([
      exercise("A", {
        rest_seconds: 60,
        superset_group: 1,
        sets: [set("a1", { weight_kg: 80, reps: 8 }, isoOffset(NOW - 1000)), set("a2", { weight_kg: 80, reps: 8 })],
      }),
      exercise("B", {
        rest_seconds: 120,
        superset_group: 1,
        sets: [set("b1", { weight_kg: 40, reps: 10 }), set("b2", { weight_kg: 40, reps: 10 })],
      }),
    ]);

    const deleted = applied(run(state, { type: "deleteSet", setUuid: "a1" }));
    const next = applied(run(deleted, { type: "completeSet", setUuid: "b1", values: { weight_kg: 40, reps: 10, duration_s: null } }));

    expect(next.rest_ends_at).toBeNull();
    expect(next.rest_total_s).toBeNull();
  });
});

describe("uuid inesistenti e stato non modificabile", () => {
  const state = workout([exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 })] })]);

  it("serie sconosciuta: 'set not found' e stato invariato", () => {
    expectRejected(run(state, { type: "patchSet", setUuid: "x", values: { weight_kg: 1, reps: 1, duration_s: null } }), "set not found", state);
    expectRejected(run(state, { type: "completeSet", setUuid: "x", values: { weight_kg: 1, reps: 1, duration_s: null } }), "set not found", state);
    expectRejected(run(state, { type: "uncompleteSet", setUuid: "x" }), "set not found", state);
    expectRejected(run(state, { type: "deleteSet", setUuid: "x" }), "set not found", state);
  });

  it("esercizio sconosciuto in addSet: 'exercise not found' e stato invariato", () => {
    expectRejected(run(state, { type: "addSet", exerciseUuid: "x", previousFirst: null }), "exercise not found", state);
  });

  it("allenamento già finito: 'workout is not in progress' e stato invariato", () => {
    const finished = workout([exercise("A", { sets: [set("a1", { weight_kg: 80, reps: 8 }, isoOffset(NOW - 1000))] })], {
      status: "finished",
      finished_at: isoOffset(NOW - 500),
    });

    expectRejected(run(finished, { type: "uncompleteSet", setUuid: "a1" }), "workout is not in progress", finished);
    expectRejected(run(finished, { type: "restSkip" }), "workout is not in progress", finished);
  });

  it("valori fuori dal limite del server: 'Valori non validi' e stato invariato", () => {
    expectRejected(run(state, { type: "patchSet", setUuid: "a1", values: { weight_kg: 1001, reps: 8, duration_s: null } }), "Valori non validi", state);
    expectRejected(run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80, reps: 1.5, duration_s: null } }), "Valori non validi", state);
  });
});

describe("C18: il giro che si chiude per ultimo fa partire il riposo dell'ultimo del gruppo", () => {
  it("b1 poi a1: parte il riposo di B (120 s), l'ultimo del gruppo", () => {
    const state = workout([
      exercise("A", { rest_seconds: 60, superset_group: 1, sets: [set("a1", { weight_kg: 80, reps: 8 })] }),
      exercise("B", { rest_seconds: 120, superset_group: 1, sets: [set("b1", { weight_kg: 40, reps: 10 })] }),
    ]);

    const afterB = applied(
      run(state, { type: "completeSet", setUuid: "b1", values: { weight_kg: 40, reps: 10, duration_s: null } }),
    );
    expect(afterB.rest_ends_at).toBeNull();
    expect(afterB.rest_total_s).toBeNull();

    const afterA = applied(
      run(afterB, { type: "completeSet", setUuid: "a1", values: { weight_kg: 80, reps: 8, duration_s: null } }),
    );
    expect(afterA.rest_total_s).toBe(120);
    expect(afterA.rest_ends_at).toBe(isoOffset(NOW + 120_000));
  });
});

describe("confini dei limiti del server e arrotondamento sul valore grezzo", () => {
  it("restDelta: ±600 s sono accettati con un timer in corso, ±601 s risponde 'Valori non validi'", () => {
    const started = applied(run(workout([exercise("A")]), { type: "restStart", seconds: 300 }));

    expect(run(started, { type: "restDelta", seconds: 600 }).ok).toBe(true);
    expect(run(started, { type: "restDelta", seconds: -600 }).ok).toBe(true);
    expectRejected(run(started, { type: "restDelta", seconds: 601 }), "Valori non validi", started);
    expectRejected(run(started, { type: "restDelta", seconds: -601 }), "Valori non validi", started);
  });

  it("duration_s: 36000 è accettato, 36001 risponde 'Valori non validi' sia in patchSet sia in completeSet", () => {
    const state = workout([exercise("D", { tracking: "duration", sets: [set("d1")] })]);

    const next = applied(run(state, { type: "completeSet", setUuid: "d1", values: { weight_kg: null, reps: null, duration_s: 36000 } }));
    expect(setOf(next, "D", 0).duration_s).toBe(36000);
    expectRejected(run(state, { type: "completeSet", setUuid: "d1", values: { weight_kg: null, reps: null, duration_s: 36001 } }), "Valori non validi", state);
    expectRejected(run(state, { type: "patchSet", setUuid: "d1", values: { weight_kg: null, reps: null, duration_s: 36001 } }), "Valori non validi", state);
  });

  it("il limite di peso si controlla sul valore inviato: 1000.004 è fuori anche se arrotondato sarebbe 1000", () => {
    const state = workout([exercise("A", { sets: [set("a1")] })]);

    expectRejected(run(state, { type: "patchSet", setUuid: "a1", values: { weight_kg: 1000.004, reps: 8, duration_s: null } }), "Valori non validi", state);
    expectRejected(run(state, { type: "completeSet", setUuid: "a1", values: { weight_kg: 1000.004, reps: 8, duration_s: null } }), "Valori non validi", state);
  });

  it("un peso di 999.999 è accettato e salvato arrotondato a 1000", () => {
    const state = workout([exercise("A", { sets: [set("a1")] })]);

    const next = applied(run(state, { type: "patchSet", setUuid: "a1", values: { weight_kg: 999.999, reps: 8, duration_s: null } }));

    expect(setOf(next, "A", 0).weight_kg).toBe(1000);
  });

  it("patchSet arrotonda il peso a 2 decimali come il server (80.125 → 80.13, 80.124 → 80.12)", () => {
    const state = workout([exercise("A", { sets: [set("a1"), set("a2")] })]);

    const next = applied(run(state, { type: "patchSet", setUuid: "a1", values: { weight_kg: 80.125, reps: 8, duration_s: null } }));
    const again = applied(run(next, { type: "patchSet", setUuid: "a2", values: { weight_kg: 80.124, reps: 8, duration_s: null } }));

    expect(setOf(again, "A", 0).weight_kg).toBe(80.13);
    expect(setOf(again, "A", 1).weight_kg).toBe(80.12);
  });
});

describe("addSet: tetto di 100 serie per esercizio", () => {
  it("con 99 serie aggiunge la centesima; con 100 risponde 'Valori non validi' e lo stato resta", () => {
    const sets = Array.from({ length: 99 }, (_, i) => set(`s${i}`, { weight_kg: 1, reps: 1 }));
    const state = workout([exercise("A", { sets })]);

    const full = applied(run(state, { type: "addSet", exerciseUuid: "A", previousFirst: null }));
    expect(full.exercises[0].sets).toHaveLength(100);

    expectRejected(run(full, { type: "addSet", exerciseUuid: "A", previousFirst: null }), "Valori non validi", full);
  });
});
