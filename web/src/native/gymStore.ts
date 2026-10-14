import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

import type { Template, Workout } from "../api/gym";
import {
  type SessionAction,
  type SessionDeps,
  type SessionWorkout,
  reduceSession,
  startEmpty,
  startFromTemplate,
} from "../lib/gymSession";
import { isNative } from "./platform";

// Stato locale dell'allenamento (ADR 0004): un file JSON in Library, riscritto in modo atomico.
// Il file non contiene mai il token. Fuori dall'IPA le funzioni che toccano il file non fanno nulla.
// Ogni cambio di forma di SessionWorkout (o di GymEntry) richiede di aumentare SCHEMA_VERSION:
// un file di schema diverso viene messo da parte, non letto.
const SCHEMA_VERSION = 1 as const;
const STORE_PATH = "yfp/gym-local.json";
const TMP_PATH = "yfp/gym-local.tmp.json";
const WRITE_DELAY_MS = 1000;
// Un errore di scrittura ripete con attesa crescente (1, 2, 4 … s), fino a questo massimo.
const MAX_RETRY_DELAY_MS = 30_000;
const ACTIVE_EXISTS = "Hai già un allenamento in corso";
const NOT_ACTIVE = "Allenamento non attivo";
const SYNC_STATES: readonly unknown[] = ["pending", "synced", "conflict", "error"];

export type SyncState = "pending" | "synced" | "conflict" | "error";

export interface GymConflict {
  reason: string;
  current: Workout | null;
}

/** Un allenamento locale. `workout.id` resta null finché il server non l'ha visto. */
export interface GymEntry {
  workout: SessionWorkout;
  /** Versione del server su cui si basano le modifiche locali; null per un allenamento mai inviato. */
  baseVersion: number | null;
  /** Contatore delle modifiche locali: sale a ogni azione applicata. */
  revision: number;
  /** Revisione già inviata al server: `revision !== sentRevision` vuol dire da inviare. */
  sentRevision: number;
  sync: SyncState;
  conflict: GymConflict | null;
  /** Ultima risposta del server per questo allenamento: sorgente di Precedente e Max (R13). */
  lastServer: Workout | null;
}

/** Annullamento offline di un allenamento già sincronizzato: parte al ritorno della rete (R20). */
export interface PendingDelete {
  id: number;
  baseVersion: number;
}

/** Forma dello store, schema 1. Un solo `active` alla volta. */
export interface GymStoreData {
  schema: typeof SCHEMA_VERSION;
  userId: number | null;
  /** Scarto dell'orologio del telefono rispetto al server, in ms (R11). */
  clockOffsetMs: number;
  active: GymEntry | null;
  finished: GymEntry[];
  pendingDeletes: PendingDelete[];
  templateProposals: number[];
}

export type DispatchResult = { ok: true; state: SessionWorkout } | { ok: false; error: string };
export type StartOutcome = { ok: true; state: SessionWorkout } | { ok: false; error: string };

/** Campi che il sync e le risposte del server possono aggiornare. La revisione non si tocca qui. */
export type EntryPatch = Partial<Pick<GymEntry, "workout" | "baseVersion" | "sentRevision" | "sync" | "conflict" | "lastServer">>;

function emptyStore(userId: number | null): GymStoreData {
  return {
    schema: SCHEMA_VERSION,
    userId,
    clockOffsetMs: 0,
    active: null,
    finished: [],
    pendingDeletes: [],
    templateProposals: [],
  };
}

let data: GymStoreData = emptyStore(null);
// Nessuna scrittura prima del caricamento: sovrascriverebbe un file non ancora letto.
let loaded = false;
// C'è una modifica non ancora scritta su file.
let dirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = WRITE_DELAY_MS;
// Le scritture e le cancellazioni si susseguono in ordine: mai due file in scrittura insieme.
let queue: Promise<void> = Promise.resolve();
let listening = false;
const listeners = new Set<() => void>();

function enqueue(task: () => Promise<void>): Promise<void> {
  const next = queue.then(task).catch(() => undefined);
  queue = next;
  return next;
}

function cancelTimer(): void {
  clearTimeout(timer);
  timer = undefined;
}

function notify(): void {
  for (const listener of listeners) listener();
}

// `useSyncExternalStore`: lo snapshot cambia riferimento solo a ogni modifica.
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): GymStoreData {
  return data;
}

function scheduleWrite(delay: number = WRITE_DELAY_MS): void {
  if (!isNative() || !loaded) return;
  cancelTimer();
  timer = setTimeout(() => {
    timer = undefined;
    void enqueue(writeStore);
  }, delay);
}

// Ogni modifica passa da qui: nuovo stato, notifica e scrittura rinviata di un secondo.
function commit(next: GymStoreData): void {
  data = next;
  dirty = true;
  notify();
  scheduleWrite();
}

async function writeStore(): Promise<void> {
  if (!dirty || !loaded) return;
  dirty = false;
  try {
    await Filesystem.writeFile({
      path: TMP_PATH,
      data: JSON.stringify(data),
      directory: Directory.Library,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    await replaceStoreFile();
    retryDelay = WRITE_DELAY_MS;
  } catch (error) {
    // La modifica resta da salvare. Con un errore permanente non si riprova ogni secondo: l'attesa raddoppia.
    dirty = true;
    scheduleWrite(retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
    throw error;
  }
}

// Il temporaneo è completo quando si arriva qui. Se il dispositivo non sostituisce il file esistente
// con il rename, si cancella il vecchio solo dopo aver verificato che il temporaneo c'è.
async function replaceStoreFile(): Promise<void> {
  const move = { from: TMP_PATH, to: STORE_PATH, directory: Directory.Library, toDirectory: Directory.Library };
  try {
    await Filesystem.rename(move);
  } catch {
    await Filesystem.stat({ path: TMP_PATH, directory: Directory.Library });
    await deleteFileIfPresent(STORE_PATH);
    await Filesystem.rename(move);
  }
}

async function deleteFileIfPresent(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Library });
  } catch {
    // File assente: non c'è niente da cancellare.
  }
}

/** Scrive subito le modifiche in attesa, senza aspettare il ritardo. */
export function flushGymStore(): Promise<void> {
  if (!isNative()) return Promise.resolve();
  cancelTimer();
  return enqueue(writeStore);
}

/** Solo per i test: attende le scritture e le cancellazioni in coda. */
export function flushGymStoreForTests(): Promise<void> {
  return queue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionSet(value: unknown): boolean {
  return isRecord(value) && typeof value.uuid === "string";
}

function isSessionExercise(value: unknown): boolean {
  return isRecord(value) && typeof value.uuid === "string" && Array.isArray(value.sets) && value.sets.every(isSessionSet);
}

// Controllo strutturale: riconosce un file corrotto o di un altro schema, ma non valida ogni campo.
function isEntry(value: unknown): value is GymEntry {
  if (!isRecord(value) || !isRecord(value.workout)) return false;
  return (
    typeof value.workout.uuid === "string" &&
    Array.isArray(value.workout.exercises) &&
    value.workout.exercises.every(isSessionExercise) &&
    (value.baseVersion === null || typeof value.baseVersion === "number") &&
    Number.isInteger(value.revision) &&
    Number.isInteger(value.sentRevision) &&
    SYNC_STATES.includes(value.sync) &&
    (value.conflict === null || isRecord(value.conflict)) &&
    (value.lastServer === null || isRecord(value.lastServer))
  );
}

function isPendingDelete(value: unknown): value is PendingDelete {
  return isRecord(value) && typeof value.id === "number" && typeof value.baseVersion === "number";
}

function isStore(value: unknown): value is GymStoreData {
  if (!isRecord(value) || value.schema !== SCHEMA_VERSION) return false;
  return (
    (value.userId === null || typeof value.userId === "number") &&
    typeof value.clockOffsetMs === "number" &&
    Number.isFinite(value.clockOffsetMs) &&
    (value.active === null || isEntry(value.active)) &&
    Array.isArray(value.finished) &&
    value.finished.every(isEntry) &&
    Array.isArray(value.pendingDeletes) &&
    value.pendingDeletes.every(isPendingDelete) &&
    Array.isArray(value.templateProposals) &&
    value.templateProposals.every((id) => typeof id === "number")
  );
}

function parseStore(text: string): GymStoreData | null {
  try {
    const value: unknown = JSON.parse(text);
    return isStore(value) ? value : null;
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: Directory.Library });
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    const { data: text } = await Filesystem.readFile({ path, directory: Directory.Library, encoding: Encoding.UTF8 });
    return String(text);
  } catch {
    return null;
  }
}

// Il file non valido non si cancella: si mette da parte con un nome datato, così resta per un'analisi.
async function setAsideCorrupt(path: string): Promise<void> {
  try {
    await Filesystem.rename({
      from: path,
      to: `yfp/gym-local.corrupt-${Date.now()}.json`,
      directory: Directory.Library,
      toDirectory: Directory.Library,
    });
  } catch {
    // Senza rinomina il file resta e la prossima scrittura lo sostituisce.
  }
}

async function readStoreAt(path: string): Promise<{ exists: boolean; store: GymStoreData | null }> {
  if (!(await fileExists(path))) return { exists: false, store: null };
  const text = await readText(path);
  return { exists: true, store: text === null ? null : parseStore(text) };
}

// Il temporaneo esiste solo tra la scrittura e il rename: se è JSON valido è più recente del principale
// (il rename è mancato, per esempio con l'app sospesa) e vince. Se è troncato non è valido e non serve.
async function loadFromDisk(): Promise<{ store: GymStoreData; recovered: boolean }> {
  const tmp = await readStoreAt(TMP_PATH);
  const main = await readStoreAt(STORE_PATH);
  if (main.exists && main.store === null) await setAsideCorrupt(STORE_PATH);
  if (tmp.store !== null) return { store: tmp.store, recovered: true };
  if (main.store !== null) return { store: main.store, recovered: false };
  // Senza file principale un temporaneo non valido non serve più: si mette da parte.
  if (tmp.exists && !main.exists) await setAsideCorrupt(TMP_PATH);
  return { store: emptyStore(null), recovered: false };
}

function listenForBackground(): void {
  if (listening) return;
  listening = true;
  // Andando in background l'app può essere chiusa dal multitasking: si scrive subito.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    void flushGymStore();
  });
}

/**
 * Carica il file locale all'avvio, prima del primo render. Indipendente dal buster della cache:
 * il file si carica anche senza token (un 401 non lo cancella, R21). Mai lancia.
 */
export async function loadGymStore(): Promise<void> {
  if (!isNative()) return;
  let result: { store: GymStoreData; recovered: boolean };
  try {
    result = await loadFromDisk();
  } catch {
    result = { store: emptyStore(null), recovered: false };
  }
  data = result.store;
  // Un temporaneo recuperato va riscritto nel file vero.
  dirty = result.recovered;
  loaded = true;
  listenForBackground();
  notify();
}

// Prima il temporaneo: al caricamento ha la precedenza, quindi un crash in mezzo non deve lasciare lui.
// Un crash tra le due cancellazioni lascia il principale: è un rischio residuo da segnalare.
async function deleteStoreFiles(): Promise<void> {
  await deleteFileIfPresent(TMP_PATH);
  await deleteFileIfPresent(STORE_PATH);
}

// Svuota memoria e file. Le scritture già in coda trovano `dirty` a false e non ricreano il file.
function wipe(userId: number | null): Promise<void> {
  cancelTimer();
  retryDelay = WRITE_DELAY_MS;
  data = emptyStore(userId);
  dirty = false;
  loaded = true;
  notify();
  if (!isNative()) return Promise.resolve();
  return enqueue(deleteStoreFiles);
}

/** Logout: cancella stato in memoria e file locale. Chiamare dopo aver cancellato il token. */
export function clearGymStore(): Promise<void> {
  return wipe(null);
}

/**
 * Associa lo store all'utente loggato (R21). Con un utente diverso da quello del file il file precedente
 * si cancella senza inviarlo e il valore restituito è true. Mai lancia.
 */
export function setGymUserId(userId: number): boolean {
  if (data.userId === userId) return false;
  if (data.userId === null) {
    commit({ ...data, userId });
    return false;
  }
  void wipe(userId);
  return true;
}

function sessionDeps(): SessionDeps {
  return { now: Date.now() + data.clockOffsetMs, uuid: () => crypto.randomUUID() };
}

function newEntry(workout: SessionWorkout): GymEntry {
  return { workout, baseVersion: null, revision: 1, sentRevision: 0, sync: "pending", conflict: null, lastServer: null };
}

/** Avvio vuoto: rifiutato se c'è già un allenamento attivo. */
export function startEmptyWorkout(): StartOutcome {
  if (data.active !== null) return { ok: false, error: ACTIVE_EXISTS };
  const state = startEmpty(sessionDeps());
  commit({ ...data, active: newEntry(state) });
  return { ok: true, state };
}

/** Avvio da un modello: rifiutato se c'è già un allenamento attivo. */
export function startWorkoutFromTemplate(template: Template): StartOutcome {
  if (data.active !== null) return { ok: false, error: ACTIVE_EXISTS };
  const started = startFromTemplate(template, sessionDeps());
  if (!started.ok) return started;
  commit({ ...data, active: newEntry(started.state) });
  return { ok: true, state: started.state };
}

/**
 * Applica un'azione all'allenamento attivo con quell'uuid. Ogni azione riuscita incrementa la revisione
 * e segna l'allenamento da sincronizzare; un allenamento finito passa da `active` a `finished`.
 */
export function dispatch(uuid: string, action: SessionAction): DispatchResult {
  const entry = data.active;
  if (entry === null || entry.workout.uuid !== uuid) return { ok: false, error: NOT_ACTIVE };
  const result = reduceSession(entry.workout, action, sessionDeps());
  if (!result.ok) return { ok: false, error: result.error };
  // Un'azione senza effetto (stesso esercizio in sostituzione) non è una modifica da inviare.
  if (result.state === entry.workout) return { ok: true, state: result.state };
  const changed: GymEntry = {
    ...entry,
    workout: result.state,
    revision: entry.revision + 1,
    // Un conflitto resta tale: la scelta dell'utente lo risolve (R18), non una nuova modifica.
    sync: entry.sync === "conflict" ? "conflict" : "pending",
  };
  if (result.state.status === "finished") {
    commit({ ...data, active: null, finished: [...data.finished, changed] });
  } else {
    commit({ ...data, active: changed });
  }
  return { ok: true, state: result.state };
}

function changeEntry(uuid: string, change: (entry: GymEntry) => GymEntry): boolean {
  const active = data.active;
  if (active !== null && active.workout.uuid === uuid) {
    commit({ ...data, active: change(active) });
    return true;
  }
  const index = data.finished.findIndex((entry) => entry.workout.uuid === uuid);
  if (index === -1) return false;
  commit({ ...data, finished: data.finished.map((entry, i) => (i === index ? change(entry) : entry)) });
  return true;
}

/** Aggiorna i campi di sync di un allenamento (attivo o finito). Restituisce false se l'uuid non c'è. */
export function patchEntry(uuid: string, patch: EntryPatch): boolean {
  return changeEntry(uuid, (entry) => {
    const next = { ...entry, ...patch };
    // `workout.version` segue sempre `baseVersion`: il reducer lo lascia com'è.
    return { ...next, workout: { ...next.workout, version: next.baseVersion } };
  });
}

/** Toglie un allenamento (attivo o finito) dallo stato locale: annullamento o fine della sincronizzazione. */
export function removeEntry(uuid: string): boolean {
  const active = data.active;
  if (active !== null && active.workout.uuid === uuid) {
    commit({ ...data, active: null });
    return true;
  }
  const finished = data.finished.filter((entry) => entry.workout.uuid !== uuid);
  if (finished.length === data.finished.length) return false;
  commit({ ...data, finished });
  return true;
}

/** Aggiunge o sostituisce (stesso id) un annullamento da inviare. */
export function addPendingDelete(item: PendingDelete): void {
  commit({ ...data, pendingDeletes: [...data.pendingDeletes.filter((pending) => pending.id !== item.id), item] });
}

export function removePendingDelete(id: number): void {
  if (!data.pendingDeletes.some((pending) => pending.id === id)) return;
  commit({ ...data, pendingDeletes: data.pendingDeletes.filter((pending) => pending.id !== id) });
}

export function setTemplateProposals(ids: number[]): void {
  commit({ ...data, templateProposals: [...new Set(ids)] });
}

export function setClockOffset(ms: number): void {
  if (!Number.isFinite(ms) || ms === data.clockOffsetMs) return;
  commit({ ...data, clockOffsetMs: ms });
}
