import { useState, useSyncExternalStore } from "react";

import { resolveConflict } from "../../native/gymSync";
import { type GymEntry, type GymStoreData, getSnapshot, subscribe } from "../../native/gymStore";
import { isNative } from "../../native/platform";

// Un conflitto sta nelle voci locali: il 409 di un PUT lascia la voce in `conflict`, e il 409 di un annullamento
// rifiutato (R20) la rimette nello stato locale con la copia del telefono in `conflict` (restoreEntry). Il dialogo
// legge quindi solo le voci, anche per i conflitti nati da un annullamento.

const RETRY_MESSAGE = "Il server ha ancora un conflitto con questo allenamento: riprova.";
const NETWORK_MESSAGE = "La scelta non è stata inviata: riprova quando c'è la rete.";
// La copia del server in corso non può prendere il posto di un allenamento in corso sul telefono (restoreEntry).
const SERVER_BLOCKED_MESSAGE =
  "Sul telefono c'è già un allenamento in corso: termina o annulla quello prima di tenere la copia del server.";

function conflictEntry(store: GymStoreData): GymEntry | undefined {
  if (store.active?.sync === "conflict" && store.active.conflict !== null) return store.active;
  return store.finished.find((entry) => entry.sync === "conflict" && entry.conflict !== null);
}

interface CopySummary {
  name: string;
  startedAt: string;
  finished: boolean;
  exercises: number;
  completed: number;
  total: number;
}

// Stesso calcolo per la copia del telefono e per quella del server: entrambe hanno esercizi con serie e `completed_at`.
function summarize(
  workout: { name: string; started_at: string; status: string; exercises: { sets: { completed_at: string | null }[] }[] },
): CopySummary {
  const sets = workout.exercises.flatMap((exercise) => exercise.sets);
  return {
    name: workout.name,
    startedAt: workout.started_at,
    finished: workout.status === "finished",
    exercises: workout.exercises.length,
    completed: sets.filter((set) => set.completed_at !== null).length,
    total: sets.length,
  };
}

function startLabel(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function CopyCard({ title, summary }: { title: string; summary: CopySummary }) {
  return (
    <section className="card p-3" aria-label={title}>
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <p className="mt-1 truncate text-[15px] font-semibold text-slate-900">{summary.name}</p>
      <ul className="mt-1 space-y-0.5 text-[13px] text-slate-700">
        <li>Inizio: {startLabel(summary.startedAt)}</li>
        <li>Esercizi: {summary.exercises}</li>
        <li>
          Serie completate: {summary.completed} su {summary.total}
        </li>
        <li>Stato: {summary.finished ? "finito" : "in corso"}</li>
      </ul>
    </section>
  );
}

function ConflictChoice({ entry }: { entry: GymEntry }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { uuid } = entry.workout;
  const conflict = entry.conflict;
  if (conflict === null) return null;
  const { reason, current } = conflict;
  const local = summarize(entry.workout);

  async function choose(choice: "local" | "server") {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await resolveConflict(uuid, choice);
      if (outcome === "conflict") setMessage(choice === "server" ? SERVER_BLOCKED_MESSAGE : RETRY_MESSAGE);
      else if (outcome === "pending" || outcome === "error" || outcome === "unauthorized") setMessage(NETWORK_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-conflict-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-[calc(1rem+var(--safe-bottom))] pt-4">
          <h2 id="sync-conflict-title" className="text-[17px] font-semibold text-slate-900">
            Allenamento in conflitto
          </h2>
          <p className="text-[14px] text-slate-700">
            {reason === "other_active"
              ? "Sul server c'è un altro allenamento in corso. Tenendo la copia del telefono, quell'altro allenamento viene annullato; tenendo la copia del server, questo allenamento sul telefono viene scartato."
              : "Questo allenamento è stato cambiato sul server mentre il telefono era offline. Scegli quale copia tenere."}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <CopyCard title="Telefono" summary={local} />
            {current === null ? (
              <section className="card flex items-center justify-center p-3" aria-label="Server">
                <p className="text-center text-[14px] font-semibold text-slate-700">Eliminato sul server</p>
              </section>
            ) : (
              <CopyCard title="Server" summary={summarize(current)} />
            )}
          </div>

          <div className="space-y-1 text-[12px] text-slate-500">
            <p>
              Tenendo la copia del telefono, l'allenamento torna al server così com'è sul telefono. Se lo avevi annullato
              offline, torna sul telefono e va annullato di nuovo.
            </p>
            <p>
              Tenendo la copia del server, la copia del telefono viene scartata. Se la copia del server è in corso e sul
              telefono c'è già un allenamento in corso, la scelta non è possibile finché non lo termini o lo annulli.
            </p>
          </div>

          {message !== null && (
            <p role="alert" className="card px-4 py-3 text-center text-sm text-red-600">
              {message}
            </p>
          )}

          <div className="space-y-2">
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void choose("local")}>
              Tieni la copia del telefono
            </button>
            <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => void choose("server")}>
              Tieni la copia del server
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dialogo di conflitto di sync (R18): solo nell'IPA, mostra la prima voce in conflitto. Dove va è deciso dal chiamante. */
function SyncConflictDialog() {
  const store = useSyncExternalStore(subscribe, getSnapshot);
  if (!isNative()) return null;
  const entry = conflictEntry(store);
  if (entry === undefined) return null;
  return <ConflictChoice key={entry.workout.uuid} entry={entry} />;
}

export default SyncConflictDialog;
