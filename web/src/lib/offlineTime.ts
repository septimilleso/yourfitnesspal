// Ora e giorno dei dati offline. Il giorno è null se i dati sono di oggi.
export function offlineTimeParts(updatedAt: number, now: Date): { time: string; day: string | null } {
  const shown = new Date(updatedAt);
  const time = shown.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (shown.toDateString() === now.toDateString()) return { time, day: null };
  const day = shown.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
  return { time, day };
}
