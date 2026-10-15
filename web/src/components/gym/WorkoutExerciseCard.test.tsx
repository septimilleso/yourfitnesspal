import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { liveWorkout, renderWorkoutPage, SQUAT, sessionItem, stubSessionApi, workoutSet } from "../../test/liveSession";

// Le operazioni sulle serie di una card, viste dalla pagina: gli endpoint devono ricevere gli id di server.

function squatWorkout(rest_seconds = 90) {
  return liveWorkout([
    sessionItem(21, SQUAT, [
      workoutSet(31, { completed_at: "2026-09-24T18:00:00Z" }),
      workoutSet(32),
    ], { rest_seconds }),
  ]);
}

describe("WorkoutExerciseCard set operations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds a set to the exercise", async () => {
    const api = stubSessionApi(squatWorkout());
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "+ Aggiungi serie (1:30)" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "POST", path: "/workouts/5/exercises/21/sets" },
    ]));
  });

  it("completes a set with the typed values and drops its pending save", async () => {
    const api = stubSessionApi(squatWorkout());
    renderWorkoutPage();
    fireEvent.change(await screen.findByLabelText("kg serie 2"), { target: { value: "85" } });

    fireEvent.click(screen.getByRole("button", { name: "Completa serie 2" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "POST", path: "/workouts/5/sets/32/complete", body: { weight_kg: 85, reps: 8, duration_s: null } },
    ]));
  });

  it("unticks a completed set", async () => {
    const api = stubSessionApi(squatWorkout());
    renderWorkoutPage();

    fireEvent.click(await screen.findByRole("button", { name: "Annulla serie 1" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "POST", path: "/workouts/5/sets/31/uncomplete" },
    ]));
  });

  it("deletes a set from its menu", async () => {
    const api = stubSessionApi(squatWorkout());
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Serie 2" }));
    await user.click(screen.getByRole("menuitem", { name: "Elimina serie" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "DELETE", path: "/workouts/5/sets/32" },
    ]));
  });

  it("changes the rest of the exercise from the rest line", async () => {
    const api = stubSessionApi(squatWorkout());
    renderWorkoutPage();
    const user = userEvent.setup();

    const [restLine] = await screen.findAllByRole("button", { name: "Riposo 1:30" });
    await user.click(restLine);
    await user.click(screen.getByRole("button", { name: "2:00" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "PATCH", path: "/workouts/5/exercises/21", body: { rest_seconds: 120 } },
    ]));
  });

  it("shows no rest line when the exercise has no rest", async () => {
    stubSessionApi(squatWorkout(0));
    renderWorkoutPage();

    await screen.findByRole("region", { name: "Barbell Squat" });
    expect(screen.queryByRole("button", { name: /^Riposo / })).not.toBeInTheDocument();
  });
});
