// Sync dell'allenamento locale verso il server (R15, R16, R17). Qui si invia un `PUT` e si applica l'esito, e si adotta
// l'allenamento attivo del server; quando inviare (trigger, coalescing, ordine) sta nello scheduler in fondo al file.
// Importa `api/gym` e lo store, mai il contrario.
import { type QueryClient, onlineManager } from "@tanstack/react-query";

import { ApiError } from "../api/client";
import {
  type ConflictBody,
  type Workout,
  type WorkoutPutBody,
  deleteWorkoutChecked,
  fetchActiveWorkout,
  gymKeys,
  putWorkout,
} from "../api/gym";
import type { SessionWorkout } from "../lib/gymSession";
import { clockOffsetMs } from "../lib/restTimer";
import { isOffline, subscribeConnectivity } from "./connectivity";
import {
  type GymConflict,
  type GymEntry,
  type PendingDelete,
  addPendingDelete,
  adoptActiveEntry,
  getSnapshot,
  patchEntry,
  removeEntry,
  removePendingDelete,
  replaceEntry,
  restoreEntry,
  setClockOffset,
  setGymUserId,
  subscribe,
} from "./gymStore";
import { getToken } from "./session";

/** Esito di un invio: chi pianifica i tentativi decide cosa fare dopo (R15). */
export type SyncOutcome = "synced" | "pending" | "conflict" | "error" | "unauthorized" | "missing";

function findEntry(uuid: string): GymEntry | undefined {
  const { active, finished } = getSnapshot();
  if (active?.workout.uuid === uuid) return active;
  return finished.find((entry) => entry.workout.uuid === uuid);
}

// Ogni risposta del server porta uuid e version (R1): se mancano la risposta non si applica.
function required<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`risposta del server senza ${field}`);
  return value;
}

// Il corpo è l'allenamento in ordine, senza id, nome e tracking degli esercizi: il server li ha già.
function bodyOf(entry: GymEntry): WorkoutPutBody {
  const { workout } = entry;
  return {
    base_version: entry.baseVersion,
    name: workout.name,
    template_id: workout.template_id,
    status: workout.status,
    started_at: workout.started_at,
    finished_at: workout.finished_at,
    rest_ends_at: workout.rest_ends_at,
    rest_total_s: workout.rest_total_s,
    exercises: workout.exercises.map((exercise) => ({
      uuid: exercise.uuid,
      exercise_id: exercise.exercise_id,
      rest_seconds: exercise.rest_seconds,
      superset_group: exercise.superset_group,
      note: exercise.note,
      sets: exercise.sets.map((set) => ({
        uuid: set.uuid,
        weight_kg: set.weight_kg,
        reps: set.reps,
        duration_s: set.duration_s,
        completed_at: set.completed_at,
      })),
    })),
  };
}

// Stato di sessione come lo vuole lo store, a partire dalla copia del server.
function sessionFromServer(server: Workout): SessionWorkout {
  return {
    uuid: required(server.uuid, "uuid"),
    id: server.id,
    version: required(server.version, "version"),
    name: server.name,
    template_id: server.template_id,
    status: server.status,
    started_at: server.started_at,
    finished_at: server.finished_at,
    rest_ends_at: server.rest_ends_at,
    rest_total_s: server.rest_total_s,
    exercises: server.exercises.map((exercise) => ({
      uuid: required(exercise.uuid, "uuid"),
      id: exercise.id,
      exercise_id: exercise.exercise.id,
      name: exercise.exercise.name,
      tracking: exercise.exercise.tracking,
      rest_seconds: exercise.rest_seconds,
      superset_group: exercise.superset_group,
      note: exercise.note,
      sets: exercise.sets.map((set) => ({
        uuid: required(set.uuid, "uuid"),
        id: set.id,
        weight_kg: set.weight_kg,
        reps: set.reps,
        duration_s: set.duration_s,
        completed_at: set.completed_at,
      })),
    })),
  };
}

// Id del server dei finiti confermati in questa sessione dell'app: quando la voce esce dallo store, il riepilogo
// locale lo cerca qui per passare alla rotta del server (R19). Solo in memoria: dopo un riavvio la voce non c'è più.
const confirmedIds = new Map<string, number>();

/** Id del server di un finito confermato dal server, o null se la conferma non c'è (ancora). */
export function confirmedServerId(uuid: string): number | null {
  return confirmedIds.get(uuid) ?? null;
}

// Modifiche arrivate durante il volo: lo stato locale resta com'è, ma prende gli id del server.
function withServerIds(local: SessionWorkout, server: Workout): SessionWorkout {
  const exerciseIds = new Map<string, number>();
  const setIds = new Map<string, number>();
  for (const exercise of server.exercises) {
    exerciseIds.set(required(exercise.uuid, "uuid"), exercise.id);
    for (const set of exercise.sets) setIds.set(required(set.uuid, "uuid"), set.id);
  }
  return {
    ...local,
    id: server.id,
    exercises: local.exercises.map((exercise) => ({
      ...exercise,
      id: exerciseIds.get(exercise.uuid) ?? exercise.id,
      sets: exercise.sets.map((set) => ({ ...set, id: setIds.get(set.uuid) ?? set.id })),
    })),
  };
}

function conflictOf(error: ApiError): GymConflict {
  const body = error.body as Partial<ConflictBody> | null;
  return { reason: body?.detail ?? error.message, current: body?.current ?? null };
}

function setSync(uuid: string, sync: GymEntry["sync"]): void {
  const entry = findEntry(uuid);
  if (entry !== undefined && entry.sync !== sync) patchEntry(uuid, { sync });
}

// 200 o 201. `sentRevision` è la revisione inviata: se nel frattempo ce ne sono state altre, restano in attesa del prossimo invio.
function applyAccepted(uuid: string, sentRevision: number, server: Workout, queryClient: QueryClient): SyncOutcome {
  const entry = findEntry(uuid);
  if (entry === undefined) {
    // Annullato mentre il PUT era in volo: il server ha la copia appena scritta, quindi l'annullamento va inviato con la sua versione (R20).
    if (cancelledInFlight.delete(uuid)) {
      const pending = getSnapshot().pendingDeletes.find((item) => item.id === server.id);
      addPendingDelete({
        id: server.id,
        baseVersion: required(server.version, "version"),
        entry: pending?.entry ?? entryFromServer(server),
      });
    }
    return "missing";
  }
  const unchanged = entry.revision === sentRevision;
  setClockOffset(clockOffsetMs(server.server_now, Date.now()));
  if (unchanged && entry.workout.status === "finished") {
    // Finito confermato: lo mette la cache dello Storico e lo tolgono dallo stato locale (R16).
    confirmedIds.set(uuid, server.id);
    queryClient.setQueryData(gymKeys.workout(server.id), server);
    void queryClient.invalidateQueries({ queryKey: gymKeys.history });
    void queryClient.invalidateQueries({ queryKey: ["gym", "stats"] });
    void queryClient.invalidateQueries({ queryKey: gymKeys.templates });
    void queryClient.invalidateQueries({ queryKey: gymKeys.offlineSnapshot });
    removeEntry(uuid);
    return "synced";
  }
  // Tutto il calcolo prima della scrittura nello store: un campo mancante non lascia uno stato a metà.
  const baseVersion = required(server.version, "version");
  const workout = unchanged ? sessionFromServer(server) : withServerIds(entry.workout, server);
  patchEntry(uuid, {
    workout,
    baseVersion,
    sentRevision,
    lastServer: server,
    sync: unchanged ? "synced" : "pending",
    conflict: null,
  });
  return unchanged ? "synced" : "pending";
}

// Ogni errore lascia intatti i dati sul telefono. 409 → conflitto (R18), 401 → nessuna modifica (R21),
// altri 4xx → errore di sincronizzazione (R16), 5xx e rete → resta da inviare (R16).
function applyFailure(uuid: string, error: unknown): SyncOutcome {
  if (error instanceof ApiError) {
    if (error.status === 401) return "unauthorized";
    if (error.status === 409) {
      patchEntry(uuid, { sync: "conflict", conflict: conflictOf(error) });
      return "conflict";
    }
    if (error.status < 500) {
      setSync(uuid, "error");
      return "error";
    }
  }
  setSync(uuid, "pending");
  return "pending";
}

/**
 * Invia l'allenamento con `PUT /api/workouts/{uuid}` e applica l'esito. Mai lancia: un errore di rete o del
 * server lascia lo stato coerente e il prossimo trigger riprova. Anche una risposta 2xx senza `uuid` o
 * `version` non si applica e finisce come errore di sincronizzazione.
 */
export async function syncEntry(uuid: string, queryClient: QueryClient): Promise<SyncOutcome> {
  const entry = findEntry(uuid);
  if (entry === undefined) return "missing";
  // Revisione inviata: al ritorno si confronta con la revisione attuale per capire se ci sono modifiche nuove.
  const sentRevision = entry.revision;
  let server: Workout;
  try {
    server = await putWorkout(uuid, bodyOf(entry));
  } catch (error) {
    cancelledInFlight.delete(uuid);
    return applyFailure(uuid, error);
  }
  try {
    return applyAccepted(uuid, sentRevision, server, queryClient);
  } catch {
    // Una 2xx senza uuid o version: il server può aver già accettato la scrittura. Si segna l'errore e il ritento
    // al primo piano può dare 409 version_conflict, che porta al dialogo di conflitto (R18) invece di perdere dati.
    setSync(uuid, "error");
    return "error";
  }
}

// Coalescing delle modifiche (R15): l'invio parte dopo questo tempo di quiete.
const SETTLE_MS = 1000;
// Al più un `PUT` in volo per uuid: chi ne chiede un altro aspetta quello già partito.
const inFlight = new Map<string, Promise<SyncOutcome>>();
// Allenamenti annullati mentre il loro `PUT` era in volo: la risposta decide se c'è da annullare anche sul server.
const cancelledInFlight = new Set<string>();
// Annullamenti con il DELETE in volo (per id): un giro sovrapposto non li rispedisce.
const deletesInFlight = new Set<number>();
// Annullamenti rifiutati con un 4xx: si ritentano solo con `retryErrors`, come i PUT in errore (R16).
const deleteErrors = new Set<number>();
// Client di React Query per `syncNow`, che riceve solo uuid e timeout. Lo imposta `startGymSync`.
let activeClient: QueryClient | null = null;
// Token con cui `["me"]` ha confermato l'utente dello stato locale (R21). Finché il token in uso non è confermato
// non si inviano PUT né DELETE e non si adotta nulla: uno stato di un altro utente non deve arrivare al server.
let confirmedToken: string | null = null;
// Riavvia il giro di sync (adozione e invii), impostato da `startGymSync` e usato da `confirmGymUser`.
let kickSync: (() => void) | null = null;

// Uno stato senza proprietario (userId null) non ha dati di nessun utente: dopo il logout lo store è vuoto.
function identityConfirmed(): boolean {
  const token = getToken();
  if (token === null) return false;
  return token === confirmedToken || getSnapshot().userId === null;
}

function finishedTime(entry: GymEntry): number {
  return Date.parse(entry.workout.finished_at ?? "") || 0;
}

// Da inviare: modifiche non ancora inviate e voce in attesa. Una voce in errore si ritenta solo se
// `retryErrors` (primo piano o apertura, R16). Un conflitto non si invia: lo sblocca la scelta dell'utente (R18).
function isSendable(entry: GymEntry, retryErrors: boolean): boolean {
  if (entry.revision === entry.sentRevision) return false;
  return entry.sync === "pending" || (entry.sync === "error" && retryErrors);
}

function sendOnce(uuid: string, queryClient: QueryClient): Promise<SyncOutcome> {
  const running = inFlight.get(uuid);
  if (running !== undefined) return running;
  // Senza identità confermata la voce resta da inviare: il giro riparte con la conferma di `["me"]`.
  if (!identityConfirmed()) return Promise.resolve("pending");
  const sending = syncEntry(uuid, queryClient).finally(() => inFlight.delete(uuid));
  inFlight.set(uuid, sending);
  return sending;
}

// DELETE con la versione nota (R20). 404: l'allenamento è già sparito, è come riuscito. 409: la copia del
// server è cambiata, e la copia del telefono torna in conflitto con `current` senza altri DELETE (R18).
async function sendDelete(pending: PendingDelete): Promise<SyncOutcome> {
  try {
    await deleteWorkoutChecked(pending.id, pending.baseVersion);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      removePendingDelete(pending.id);
      return "synced";
    }
    if (error instanceof ApiError && error.status === 401) return "unauthorized";
    if (error instanceof ApiError && error.status === 409) {
      removePendingDelete(pending.id);
      // Un annullamento creato dal codice porta sempre la copia del telefono (cancelLocal, applyAccepted). Senza copia
      // il caso è solo teorico: non ci sono file salvati di questo tipo, e l'annullamento si chiude senza conflitto.
      if (pending.entry !== undefined) restoreEntry({ ...pending.entry, sync: "conflict", conflict: conflictOf(error) });
      return "conflict";
    }
    // Altro 4xx: errore di sincronizzazione, non si ritenta a ogni trigger.
    if (error instanceof ApiError && error.status < 500) return "error";
    return "pending";
  }
  removePendingDelete(pending.id);
  return "synced";
}

// Un giro: prima gli annullamenti in attesa (R20), poi i finiti in ordine di fine, poi l'attivo (R15).
// Si ferma alla rete assente, al 401 e a un'identità non ancora confermata.
async function sendQueue(queryClient: QueryClient, retryErrors: boolean): Promise<void> {
  if (!identityConfirmed() || isOffline() || !onlineManager.isOnline()) return;
  for (const pending of getSnapshot().pendingDeletes) {
    // Lo stesso annullamento non parte due volte: un giro sovrapposto lo salta mentre il DELETE è in volo, e non
    // rispedisce quello già concluso (lo store non lo ha più). Un 4xx si ritenta solo con `retryErrors`.
    if (deletesInFlight.has(pending.id) || !getSnapshot().pendingDeletes.some((item) => item.id === pending.id)) continue;
    if (!retryErrors && deleteErrors.has(pending.id)) continue;
    // Un PUT in volo dello stesso allenamento va prima: il suo esito dà la versione da cancellare.
    if (pending.entry !== undefined && inFlight.has(pending.entry.workout.uuid)) continue;
    // Segnato prima dell'await: un giro sovrapposto che arriva ora lo trova già in volo.
    deletesInFlight.add(pending.id);
    let outcome: SyncOutcome;
    try {
      outcome = await sendDelete(pending);
    } finally {
      deletesInFlight.delete(pending.id);
    }
    if (outcome === "error") deleteErrors.add(pending.id);
    else deleteErrors.delete(pending.id);
    if (outcome === "unauthorized" || isOffline() || !onlineManager.isOnline()) return;
  }
  const { active, finished } = getSnapshot();
  const order = [...finished].sort((a, b) => finishedTime(a) - finishedTime(b));
  if (active !== null) order.push(active);
  for (const { workout } of order) {
    // Si ricontrolla prima di ogni invio: mentre il giro aspetta, la voce può essere già stata inviata.
    const entry = findEntry(workout.uuid);
    if (entry === undefined || !isSendable(entry, retryErrors)) continue;
    const outcome = await sendOnce(workout.uuid, queryClient);
    // Si ferma solo per il 401 o per la rete assente: un errore del server su una voce non blocca le altre.
    if (outcome === "unauthorized" || isOffline() || !onlineManager.isOnline()) return;
  }
}

/** Esito dell'adozione (R17). `failed`: il server non ha risposto e il giro prosegue; `unauthorized`: il giro si ferma. */
export type AdoptOutcome = "adopted" | "removed" | "unchanged" | "unauthorized" | "failed";

// Le parti dello store che l'adozione legge. Lo store cambia il riferimento di una parte solo quando la cambia
// (ogni commit spread di `data`, e `setClockOffset` non tocca queste parti), quindi il confronto per identità
// dice se qualcosa è cambiato durante la GET: in quel caso la risposta è più vecchia del locale.
interface SeenState {
  active: GymEntry | null;
  finished: GymEntry[];
  pendingDeletes: PendingDelete[];
}

function seenState(): SeenState {
  const { active, finished, pendingDeletes } = getSnapshot();
  return { active, finished, pendingDeletes };
}

function changedSince(seen: SeenState): boolean {
  const now = getSnapshot();
  return now.active !== seen.active || now.finished !== seen.finished || now.pendingDeletes !== seen.pendingDeletes;
}

// Voce locale di un allenamento attivo preso dal server: nessuna modifica locale, quindi revisione e inviata coincidono.
function entryFromServer(server: Workout): GymEntry {
  const workout = sessionFromServer(server);
  return {
    workout,
    baseVersion: workout.version,
    revision: 0,
    sentRevision: 0,
    sync: "synced",
    conflict: null,
    lastServer: server,
  };
}

// Regole di R17 applicate allo stato attuale, senza await in mezzo. `seenKey` è lo stato di prima della GET.
function applyAdoption(server: Workout | null, seen: SeenState): AdoptOutcome {
  if (changedSince(seen)) return "unchanged";
  const { active, finished, pendingDeletes } = getSnapshot();
  // Un finito in attesa di sync, o un annullamento offline in attesa, ha questo allenamento sul server: non si riadotta (R16, R20).
  if (server !== null) {
    const finishedHere = finished.some((entry) => entry.workout.uuid === server.uuid);
    if (finishedHere || pendingDeletes.some((pending) => pending.id === server.id)) return "unchanged";
  }
  if (active === null) {
    if (server === null) return "unchanged";
    // Nessun locale: si adotta.
    adoptActiveEntry(entryFromServer(server));
    return "adopted";
  }
  const { uuid } = active.workout;
  // Un PUT in volo o un conflitto aspettano il loro esito: lo stato non si tocca.
  if (inFlight.has(uuid) || active.sync === "conflict") return "unchanged";
  const hasChanges = active.revision !== active.sentRevision;
  const clean = !hasChanges && active.sync === "synced" && active.baseVersion !== null;
  if (server === null) {
    // Finito o annullato altrove: il locale sincronizzato senza modifiche si toglie.
    if (!clean) return "unchanged";
    removeEntry(uuid);
    return "removed";
  }
  if (server.uuid !== uuid) {
    // Uuid diverso: con il locale pulito il server vince (scelta dell'utente). Con modifiche in attesa decide il PUT (other_active).
    if (!clean) return "unchanged";
    const entry = entryFromServer(server);
    removeEntry(uuid);
    adoptActiveEntry(entry);
    return "adopted";
  }
  // Stesso uuid: si adotta solo una versione più alta e senza modifiche in attesa.
  if (hasChanges || active.baseVersion === null || server.version === undefined || server.version <= active.baseVersion) return "unchanged";
  patchEntry(uuid, {
    workout: sessionFromServer(server),
    baseVersion: server.version,
    sentRevision: active.revision,
    sync: "synced",
    conflict: null,
    lastServer: server,
  });
  return "adopted";
}

/**
 * Adotta l'allenamento attivo del server (R17) e aggiorna lo scarto d'orologio. Va chiamata all'apertura e al
 * ritorno in primo piano, prima dei PUT. Mai lancia: rete o 5xx danno `failed` e il sync prosegue.
 */
export async function adoptServerActive(): Promise<AdoptOutcome> {
  if (getToken() === null) return "unauthorized";
  // Token non ancora confermato da `["me"]`: l'attivo del server potrebbe essere di un altro utente. Si riprova dopo.
  if (!identityConfirmed()) return "failed";
  if (isOffline() || !onlineManager.isOnline()) return "failed";
  const seen = seenState();
  let server: Workout | null;
  try {
    server = await fetchActiveWorkout();
  } catch (error) {
    return error instanceof ApiError && error.status === 401 ? "unauthorized" : "failed";
  }
  try {
    if (server !== null) setClockOffset(clockOffsetMs(server.server_now, Date.now()));
    return applyAdoption(server, seen);
  } catch {
    // Copia del server senza uuid o version: non si applica, il sync prosegue con lo stato locale.
    return "failed";
  }
}

/**
 * Avvia il sync dell'IPA (R15): dopo ogni modifica con 1 s di quiete, al ritorno della rete, al ritorno in
 * primo piano e all'apertura con un token. Non dipende dal throttle del precarico. All'apertura e al ritorno
 * in primo piano l'attivo del server (R17) viene adottato prima dei PUT. Restituisce la funzione che ferma i trigger.
 */
export function startGymSync(queryClient: QueryClient): () => void {
  activeClient = queryClient;
  let settle: ReturnType<typeof setTimeout> | undefined;
  // Se l'ultima adozione è fallita (p.es. app aperta offline), il ritorno della rete la rifà.
  let adoptionFailed = false;
  const run = (retryErrors: boolean, adopt = false) => {
    void (async () => {
      if (adopt) {
        const outcome = await adoptServerActive();
        adoptionFailed = outcome === "failed";
        if (outcome === "unauthorized") return;
      }
      await sendQueue(queryClient, retryErrors);
    })().catch(() => undefined);
  };
  const kick = () => run(true, true);
  kickSync = kick;

  const unsubscribeStore = subscribe(() => {
    clearTimeout(settle);
    settle = setTimeout(() => run(false), SETTLE_MS);
  });
  const unsubscribeConnectivity = subscribeConnectivity(() => {
    if (!isOffline()) run(false, adoptionFailed);
  });
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") run(true, true);
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  run(true, true);

  return () => {
    clearTimeout(settle);
    unsubscribeStore();
    unsubscribeConnectivity();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (activeClient === queryClient) activeClient = null;
    if (kickSync === kick) kickSync = null;
  };
}

/**
 * Chiamata a ogni risposta riuscita di `["me"]`, con il token che l'ha richiesta (R21). Lo stato locale passa a
 * quell'utente: se era di un altro si svuota senza invii. Poi il sync riparte. Un token diverso da quello in uso
 * non conta: la risposta riguarda una sessione già chiusa.
 */
export function confirmGymUser(userId: number, token: string | null): void {
  if (token === null || token !== getToken()) return;
  setGymUserId(userId);
  // Un rinnovo di `["me"]` con lo stesso token non riavvia il giro: serve solo alla prima conferma.
  if (confirmedToken === token) return;
  confirmedToken = token;
  kickSync?.();
}

// Ripete l'invio solo se durante il volo sono arrivate modifiche e il server ha accettato la revisione inviata
// (sentRevision è avanzato). Un errore del server o la rete assente danno l'esito subito, senza ripetere.
async function sendUntilSettled(uuid: string, queryClient: QueryClient): Promise<SyncOutcome> {
  for (;;) {
    const sentBefore = findEntry(uuid)?.sentRevision;
    const outcome = await sendOnce(uuid, queryClient);
    if (outcome !== "pending" || isOffline()) return outcome;
    const entry = findEntry(uuid);
    if (entry === undefined || entry.sentRevision === sentBefore || entry.revision === entry.sentRevision) return outcome;
  }
}

/**
 * Invia subito l'allenamento e aspetta l'esito per al massimo `timeoutMs` (Termina, R19). Oltre il tempo
 * restituisce "timeout": il PUT prosegue e applica l'esito da solo. Un conflitto non si invia.
 */
export async function syncNow(uuid: string, timeoutMs: number): Promise<SyncOutcome | "timeout"> {
  const queryClient = activeClient;
  if (queryClient === null) return "pending";
  const entry = findEntry(uuid);
  if (entry === undefined) return "missing";
  if (entry.sync === "conflict") return "conflict";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const sending = sendUntilSettled(uuid, queryClient).catch((): SyncOutcome => "error");
  try {
    return await Promise.race([sending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Annulla l'allenamento locale (R20). Mai sincronizzato: si toglie solo in locale, anche offline. Già sincronizzato:
 * si toglie e resta un annullamento in attesa, con la versione nota, che parte al ritorno della rete.
 */
export function cancelLocal(uuid: string): boolean {
  const entry = findEntry(uuid);
  if (entry === undefined) return false;
  removeEntry(uuid);
  if (inFlight.has(uuid)) cancelledInFlight.add(uuid);
  if (entry.baseVersion === null || entry.workout.id === null) return true;
  addPendingDelete({ id: entry.workout.id, baseVersion: entry.baseVersion, entry });
  return true;
}

// DELETE senza versione dell'altro allenamento in corso (R18). 404: è già sparito. Restituisce l'esito se la scelta si ferma.
async function removeOtherActive(id: number): Promise<SyncOutcome | null> {
  try {
    await deleteWorkoutChecked(id);
    return null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    if (error instanceof ApiError && error.status === 401) return "unauthorized";
    return "conflict";
  }
}

/**
 * Applica la scelta dell'utente su un conflitto (R18). "local": con `version_conflict` si reinvia con la versione
 * di `current` (o null); con `other_active` si annulla prima l'altro allenamento e poi si reinvia. "server": la copia
 * del server prende il posto di quella locale. Se la scelta non riesce il conflitto resta e si può riprovare.
 */
export async function resolveConflict(uuid: string, choice: "local" | "server"): Promise<SyncOutcome> {
  const entry = findEntry(uuid);
  if (entry === undefined || entry.sync !== "conflict" || entry.conflict === null) return "missing";
  const { reason, current } = entry.conflict;
  if (choice === "server") {
    let copy: GymEntry | null;
    try {
      copy = current?.status === "in_progress" ? entryFromServer(current) : null;
    } catch {
      return "error";
    }
    if (!replaceEntry(uuid, copy)) return "conflict";
    return copy === null ? "missing" : "synced";
  }
  const queryClient = activeClient;
  if (queryClient === null || !identityConfirmed()) return "pending";
  const baseVersion = reason === "other_active" ? entry.baseVersion : (current?.version ?? null);
  if (reason === "other_active" && current !== null) {
    const stopped = await removeOtherActive(current.id);
    if (stopped !== null) return stopped;
  }
  patchEntry(uuid, { baseVersion, sync: "pending", conflict: null });
  return sendOnce(uuid, queryClient);
}
