import { hashKey, type QueryClient, type QueryKey } from "@tanstack/react-query";

import type { Me } from "../api/auth";
import { ApiError, NetworkError } from "../api/client";
import {
  EMPTY_FILTERS,
  fetchExerciseProgress,
  fetchExercises,
  fetchGymCount,
  fetchGymStats,
  fetchHistoryPage,
  fetchPerformedExercises,
  fetchTemplate,
  fetchTemplates,
  fetchWorkout,
  gymKeys,
} from "../api/gym";
import { diaryKeys, fetchDayDiary, fetchDiaryRange, fetchGoal, fetchStreak, fetchWeekDiary } from "../api/queries";
import { fetchSavedWeek, fetchSavedWeeks, savedWeekKeys } from "../api/savedWeeks";
import { fetchTodayWeight, fetchWeightHistory, weightKeys } from "../api/weights";
import { shiftIsoDate, startOfWeek, todayIso } from "../lib/date";
import { PRESETS, presetPeriod } from "../lib/stats";
import { pruneStaleQueries } from "./cachePrune";
import { holdQueryPersistence } from "./queryPersistence";
import { getToken } from "./session";

// Tetti di R10: il peso della cache resta limitato anche con molti modelli o settimane salvate.
export const MAX_TEMPLATE_DETAILS = 30;
export const MAX_SAVED_WEEK_DETAILS = 10;
// Richieste contemporanee del giro (R11): due lavoratori pescano dalla stessa coda.
export const MAX_CONCURRENT = 2;

export type PrefetchOutcome = "completed" | "aborted";

// Un compito scarica una query, la scrive in cache e restituisce i compiti figli (per esempio i dettagli di un elenco).
type Task = () => Promise<Task[]>;

// Un giro di precarico: scarica le query di R4, le scrive in cache e poi pulisce le query vecchie.
// Non rifiuta mai: ogni esito è "completed" o "aborted".
export async function runPrefetchRound(queryClient: QueryClient): Promise<PrefetchOutcome> {
  // Il giro vive nella sessione di questo token: se cambia, o se manca, non parte.
  const token = getToken();
  const me = queryClient.getQueryData<Me | null>(["me"]);
  if (token === null || !me || !Array.isArray(me.permissions)) return "aborted";
  const canGym = me.role === "admin" || me.permissions.includes("workouts.use");
  const canCopy = me.role === "admin" || me.permissions.includes("diary.copy");

  const today = todayIso();
  const yesterday = shiftIsoDate(today, -1);
  const monday = startOfWeek(today);
  const periods = PRESETS.map((days) => presetPeriod(days, today));

  // Stato del giro: `aborted` è irreversibile, e il giro non scrive più dopo che è vero.
  let aborted = false;
  const alive = () => !aborted && getToken() === token;

  // Hash delle chiavi del giro, anche dei dettagli saltati perché già in cache: la pulizia non le tocca.
  const roundHashes = new Set<string>();
  const keep = (key: QueryKey) => {
    roundHashes.add(hashKey(key));
  };
  const set = (key: QueryKey, data: unknown) => {
    if (!alive()) {
      aborted = true;
      return;
    }
    queryClient.setQueryData(key, data);
    keep(key);
  };
  const load =
    <T>(key: QueryKey, fetcher: () => Promise<T>, children: (data: T) => Task[] = () => []): Task =>
    async () => {
      const data = await fetcher();
      set(key, data);
      return children(data);
    };

  // Dettagli degli allenamenti: quelli già in cache non si riscaricano.
  const workoutDetails = (ids: number[]): Task[] =>
    ids.flatMap((id) => {
      if (queryClient.getQueryData(gymKeys.workout(id)) !== undefined) {
        keep(gymKeys.workout(id));
        return [];
      }
      return [load(gymKeys.workout(id), () => fetchWorkout(id))];
    });

  // Storico: la prima pagina scrive la forma di useInfiniteQuery, salvo che la HistoryPage sia aperta.
  const history: Task = async () => {
    const page = await fetchHistoryPage(null);
    const observed = (queryClient.getQueryCache().find({ queryKey: gymKeys.history })?.getObserversCount() ?? 0) > 0;
    if (observed) keep(gymKeys.history);
    else set(gymKeys.history, { pages: [page], pageParams: [null] });
    return workoutDetails(page.items.map((item) => item.id));
  };

  const gymTasks: Task[] = [
    load(gymKeys.templates, () => fetchTemplates(), (data) =>
      data.templates
        .slice(0, MAX_TEMPLATE_DETAILS)
        .map((template) => load(gymKeys.template(template.id), () => fetchTemplate(template.id))),
    ),
    load(gymKeys.exercises(EMPTY_FILTERS), () => fetchExercises(EMPTY_FILTERS)),
    history,
    load(gymKeys.statsCount, () => fetchGymCount()),
    ...periods.map((p) => load(gymKeys.stats(p.start, today), () => fetchGymStats(p.start, today))),
    load(gymKeys.statsExercises, () => fetchPerformedExercises(), (list) => {
      const first = list[0];
      if (!first) return [];
      // Progressione del primo esercizio: è la selezione predefinita di ExerciseProgressSection.
      return periods.map((p) =>
        load(gymKeys.progress(first.exercise_id, p.start, today), () =>
          fetchExerciseProgress(first.exercise_id, p.start, today),
        ),
      );
    }),
  ];

  const copyTasks: Task[] = [
    load(savedWeekKeys.list, () => fetchSavedWeeks(), (list) =>
      list
        .slice(0, MAX_SAVED_WEEK_DETAILS)
        .map((week) => load(savedWeekKeys.detail(week.id), () => fetchSavedWeek(week.id))),
    ),
  ];

  const tasks: Task[] = [
    load(diaryKeys.day(today), () => fetchDayDiary(today)),
    load(diaryKeys.day(yesterday), () => fetchDayDiary(yesterday)),
    load(diaryKeys.week(monday), () => fetchWeekDiary(monday)),
    load(diaryKeys.goals, () => fetchGoal()),
    load(diaryKeys.streak, () => fetchStreak()),
    load(weightKeys.today, () => fetchTodayWeight()),
    ...periods.flatMap((p) => [
      load(diaryKeys.range(p.start, today), () => fetchDiaryRange(p.start, today)),
      load(weightKeys.range(p.start, today), () => fetchWeightHistory(p.start, today)),
    ]),
    ...(canGym ? gymTasks : []),
    ...(canCopy ? copyTasks : []),
  ];

  // Errore di un compito. La rete assente e la sessione scaduta fermano il giro; gli altri errori no.
  const failTask = (error: unknown) => {
    if (error instanceof NetworkError) {
      // Il client ha già segnalato la rete assente: il giro si chiude senza altre richieste.
      aborted = true;
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      aborted = true;
      // Il client ha già tolto token e file, se il token era ancora questo. Un token nuovo (o nessuno) non si tocca.
      const current = getToken();
      if (current === null || current === token) {
        queryClient.setQueryData(["me"], null);
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    }
    // Altri errori: il compito non scrive nulla e il giro prosegue.
  };

  // Coda condivisa: un lavoratore esce quando la coda è vuota. Se un altro sta ancora producendo figli, li esegue lui.
  const queue: Task[] = [...tasks];
  const worker = async (): Promise<void> => {
    while (!aborted) {
      const task = queue.shift();
      if (task === undefined) return;
      if (!alive()) {
        aborted = true;
        return;
      }
      try {
        queue.push(...(await task()));
      } catch (error) {
        failTask(error);
      }
    }
  };

  // Sospensione delle scritture per tutto il giro: il rilascio nel finally vale anche se il giro si interrompe.
  const release = holdQueryPersistence();
  try {
    await Promise.all(Array.from({ length: MAX_CONCURRENT }, () => worker()));
    // Un giro interrotto non pulisce: la pulizia sta solo a fine di un giro completato.
    if (!alive()) return "aborted";
    pruneStaleQueries(queryClient, roundHashes, Date.now());
    return "completed";
  } finally {
    release();
  }
}
