import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BENCH,
  liveWorkout,
  renderWorkoutPage,
  SQUAT,
  sessionItem,
  stubSessionApi,
  workoutSet,
} from "../../test/liveSession";

// Azioni della pagina sulla sessione web: ogni tocco deve produrre la stessa richiesta di oggi.

function twoExercises(squatGroup: number | null = null, benchGroup: number | null = null) {
  return liveWorkout([
    sessionItem(21, SQUAT, [workoutSet(31, { completed_at: "2026-09-24T18:00:00Z" }), workoutSet(32)], {
      superset_group: squatGroup,
    }),
    sessionItem(22, BENCH, [workoutSet(33)], { superset_group: benchGroup }),
  ]);
}

describe("WorkoutPage actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds the exercises picked in the selector", async () => {
    const api = stubSessionApi(twoExercises());
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "+ Aggiungi esercizio" }));
    await user.click(await screen.findByRole("button", { name: /^Leg press/ }));
    await user.click(screen.getByRole("button", { name: "Aggiungi (1)" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "POST", path: "/workouts/5/exercises", body: { exercise_id: 9 } },
    ]));
  });

  it("replaces an exercise with the one picked in the selector", async () => {
    const api = stubSessionApi(twoExercises());
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Azioni Barbell Squat" }));
    await user.click(screen.getByRole("menuitem", { name: "Sostituisci esercizio" }));
    await user.click(await screen.findByRole("button", { name: /^Leg press/ }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "PATCH", path: "/workouts/5/exercises/21", body: { exercise_id: 9 } },
    ]));
  });

  it("moves an exercise up", async () => {
    const api = stubSessionApi(twoExercises());
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Azioni Panca piana" }));
    await user.click(screen.getByRole("menuitem", { name: "Sposta su" }));

    await waitFor(() => expect(api.requests).toEqual([
      {
        method: "PUT",
        path: "/workouts/5/layout",
        body: { items: [{ id: 22, superset_group: null }, { id: 21, superset_group: null }] },
      },
    ]));
  });

  it("links an exercise to the next one", async () => {
    const api = stubSessionApi(twoExercises());
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Azioni Barbell Squat" }));
    await user.click(screen.getByRole("menuitem", { name: "Collega al successivo" }));

    await waitFor(() => expect(api.requests).toEqual([
      {
        method: "PUT",
        path: "/workouts/5/layout",
        body: { items: [{ id: 21, superset_group: 1 }, { id: 22, superset_group: 1 }] },
      },
    ]));
  });

  it("unlinks a superset", async () => {
    const api = stubSessionApi(twoExercises(1, 1));
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Azioni Barbell Squat" }));
    await user.click(screen.getByRole("menuitem", { name: "Scollega superserie" }));

    await waitFor(() => expect(api.requests).toEqual([
      {
        method: "PUT",
        path: "/workouts/5/layout",
        body: { items: [{ id: 21, superset_group: null }, { id: 22, superset_group: null }] },
      },
    ]));
  });

  it("changes the rest of an exercise from its menu", async () => {
    const api = stubSessionApi(twoExercises());
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Azioni Barbell Squat" }));
    await user.click(screen.getByRole("menuitem", { name: "Riposo" }));
    await user.click(screen.getByRole("button", { name: "2:00" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "PATCH", path: "/workouts/5/exercises/21", body: { rest_seconds: 120 } },
    ]));
  });

  it("starts a manual rest timer", async () => {
    const api = stubSessionApi(twoExercises());
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Timer di riposo" }));
    await user.click(screen.getByRole("button", { name: "2:00" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "POST", path: "/workouts/5/rest", body: { start_s: 120 } },
    ]));
  });

  it("adjusts the running rest by 15 seconds and skips it", async () => {
    const restEndsAt = new Date(Date.now() + 90_000).toISOString();
    const api = stubSessionApi(liveWorkout(twoExercises().exercises, {
      rest_ends_at: restEndsAt, rest_total_s: 90,
    }));
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "+15s" }));
    await user.click(screen.getByRole("button", { name: "-15s" }));
    await user.click(screen.getByRole("button", { name: "Salta" }));

    await waitFor(() => expect(api.requests).toEqual([
      { method: "POST", path: "/workouts/5/rest", body: { delta_s: 15 } },
      { method: "POST", path: "/workouts/5/rest", body: { delta_s: -15 } },
      { method: "POST", path: "/workouts/5/rest", body: { skip: true } },
    ]));
  });

  it("renames the workout on blur", async () => {
    const api = stubSessionApi(twoExercises());
    renderWorkoutPage();
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Nome allenamento" });

    await user.clear(name);
    await user.type(name, "Gambe");
    await user.tab();

    await waitFor(() => expect(api.requests).toEqual([
      { method: "PATCH", path: "/workouts/5", body: { name: "Gambe" } },
    ]));
  });

  it("does not rename the workout when the name is unchanged", async () => {
    const api = stubSessionApi(twoExercises());
    renderWorkoutPage();
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Nome allenamento" });

    await user.click(name);
    await user.tab();

    expect(api.requests).toEqual([]);
  });

  it("cancels the workout after confirmation", async () => {
    const api = stubSessionApi(twoExercises());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Annulla allenamento" }));

    expect(confirm).toHaveBeenCalledWith("Annullare l'allenamento? Le serie registrate verranno eliminate.");
    expect(await screen.findByText("start page")).toBeInTheDocument();
    expect(api.requests).toEqual([{ method: "DELETE", path: "/workouts/5" }]);
  });

  it("keeps the workout when the cancel is not confirmed", async () => {
    const api = stubSessionApi(twoExercises());
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Annulla allenamento" }));

    expect(api.requests).toEqual([]);
  });

  it("finishes after confirming the discarded sets", async () => {
    const api = stubSessionApi(twoExercises());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Termina" }));

    expect(confirm).toHaveBeenCalledWith("Ci sono 2 serie non completate. Verranno scartate.");
    expect(await screen.findByText("summary page")).toBeInTheDocument();
    expect(api.requests).toEqual([
      { method: "POST", path: "/workouts/5/finish", body: { discard_incomplete: true } },
    ]);
  });

  it("finishes without asking when every set is completed", async () => {
    const complete = liveWorkout([
      sessionItem(21, SQUAT, [workoutSet(31, { completed_at: "2026-09-24T18:00:00Z" })]),
    ]);
    const api = stubSessionApi(complete);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkoutPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Termina" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByText("summary page")).toBeInTheDocument();
    expect(api.requests).toEqual([
      { method: "POST", path: "/workouts/5/finish", body: { discard_incomplete: false } },
    ]);
  });

  it("shows the connection toast when a live edit gets no network", async () => {
    stubSessionApi(twoExercises(), {
      networkDown: (method, path) => method === "POST" && path.endsWith("/sets"),
    });
    renderWorkoutPage();
    const user = userEvent.setup();

    const region = await screen.findByRole("region", { name: "Barbell Squat" });
    await user.click(within(region).getByRole("button", { name: "+ Aggiungi serie (1:30)" }));

    expect(await screen.findByRole("alert", {}, { timeout: 6000 })).toHaveTextContent(
      "Non salvato: controlla la connessione",
    );
  }, 10_000);
});
