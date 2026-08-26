/** UTC-safe date helpers for the ISO ("YYYY-MM-DD") diary/calendar dates
 * used throughout the app.
 *
 * These dates are calendar dates, not instants -- shifting them must never
 * be influenced by the browser's local timezone. The bug this module fixes
 * (CRITICAL 2 of the final review): `DayPage`/`WeekPage`/`SearchPage` each
 * used to parse an ISO date as LOCAL time (`new Date(`${iso}T00:00:00`)`)
 * but read the result back via `.toISOString()` (UTC). In any positive UTC
 * offset (including Europe/Rome, this app's deploy timezone), mixing local
 * construction with UTC reading shifts the result by the offset -- date
 * navigation skips/repeats days, and "today" can resolve to yesterday
 * between local midnight and the UTC offset boundary.
 *
 * The fix: never mix local-time and UTC-time Date APIs on the same value.
 * `shiftIsoDate` uses `Date.UTC`/UTC getters exclusively (pure calendar-day
 * arithmetic, unaffected by timezone/DST). `todayIso` uses local getters
 * exclusively (so "today" matches what the user's device clock says today
 * is, not a UTC-shifted reading of it).
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Today's date, as the LOCAL calendar date, formatted as an ISO date
 * string. Deliberately built from local `Date` getters (`getFullYear`/
 * `getMonth`/`getDate`), never `toISOString()`. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Shift an ISO calendar date by `days` (may be negative), returning the
 * result as an ISO date string. Pure UTC arithmetic throughout -- parses
 * `iso`'s year/month/day into `Date.UTC`, shifts via `setUTCDate`, and reads
 * back with UTC getters, so the result never depends on the browser's local
 * timezone or DST. */
export function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
