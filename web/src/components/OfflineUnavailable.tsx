interface OfflineUnavailableProps {
  /** Senza card, per le sezioni dentro una card. */
  compact?: boolean;
}

/** Messaggio al posto dei dati che la rete non ha portato e che non sono in cache. */
export default function OfflineUnavailable({ compact = false }: OfflineUnavailableProps) {
  if (compact) {
    return (
      <p data-testid="offline-unavailable" className="py-2 text-center text-xs text-slate-500">
        <span className="block text-sm font-semibold text-slate-700">Non disponibile offline</span>
        Aprila con la rete per averla anche offline.
      </p>
    );
  }

  return (
    <div data-testid="offline-unavailable" className="card px-4 py-6 text-center">
      <p className="text-sm font-semibold text-slate-700">Non disponibile offline</p>
      <p className="text-xs text-slate-500">Aprila con la rete per averla anche offline.</p>
    </div>
  );
}
