import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import type { Goal, WeekDayTotal } from "../api/queries";
import { useGoal, useWeekDiary } from "../api/queries";
import { useHasPermission } from "../auth/AuthContext";
import CopyDaysDialog from "../components/CopyDaysDialog";
import ModeSwitch from "../components/ModeSwitch";
import OfflineUnavailable from "../components/OfflineUnavailable";
import SaveWeekDialog from "../components/SaveWeekDialog";
import { formatIsoDateShort, shiftIsoDate, startOfWeek, todayIso } from "../lib/date";
import { useOfflineUnavailable } from "../lib/useOfflineUnavailable";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

function dayLabel(index: number): string {
  return WEEKDAY_LABELS[index] ?? "";
}

interface DayCellProps {
  day: WeekDayTotal;
  index: number;
  selected: boolean;
  goal: Goal | null;
  onToggle: (date: string) => void;
  onCopyDay: (date: string) => void;
}

function DayCell({ day, index, selected, goal, onToggle, onCopyDay }: DayCellProps) {
  const overGoalKcal = goal !== null && day.total.kcal > goal.kcal;
  const kcalColor = goal === null ? "text-slate-900" : overGoalKcal ? "text-red-600" : "text-green-600";

  const overGoalProtein = goal !== null && day.total.protein_g > goal.protein_g;
  const proteinColor = goal === null ? "text-slate-700" : overGoalProtein ? "text-red-600" : "text-green-600";

  const overGoalCarbs = goal !== null && day.total.carbs_g > goal.carbs_g;
  const carbsColor = goal === null ? "text-slate-700" : overGoalCarbs ? "text-red-600" : "text-green-600";

  const overGoalFat = goal !== null && day.total.fat_g > goal.fat_g;
  const fatColor = goal === null ? "text-slate-700" : overGoalFat ? "text-red-600" : "text-green-600";

  const isToday = day.date === todayIso();
  /* Share of the kcal goal, as a hairline meter under the header -- the
     grid used to be seven blocks of identical numbers with no way to
     compare days at a glance. */
  const kcalPct = goal && goal.kcal > 0 ? Math.min((day.total.kcal / goal.kcal) * 100, 100) : 0;

  return (
    <div
      className={`card overflow-hidden transition ${
        selected ? "ring-2 ring-brand-500 ring-offset-2 ring-offset-app" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2">
        <label className="flex min-h-[44px] flex-1 items-center gap-2.5">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(day.date)}
            aria-label={`Seleziona ${day.date}`}
          />
          <span className="flex items-baseline gap-1.5">
            <span className="text-[15px] font-semibold text-slate-900">{dayLabel(index)}</span>
            <span className="text-[13px] text-slate-500">{formatIsoDateShort(day.date)}</span>
            {isToday && (
              <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand-700">
                Oggi
              </span>
            )}
          </span>
        </label>
        <button
          type="button"
          onClick={() => onCopyDay(day.date)}
          aria-label={`Altre azioni ${day.date}`}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg text-slate-400 active:bg-slate-100 active:text-slate-700"
        >
          &#8943;
        </button>
      </div>

      <div className="space-y-2 px-3 py-3">
        <div className="flex items-baseline justify-between">
          <span>
            <span className={`text-2xl font-bold tabular-nums ${kcalColor}`}>
              {Math.round(day.total.kcal)}
            </span>
            <span className="ml-1 text-xs text-slate-400">kcal</span>
          </span>
          {goal !== null && (
            <span className="text-xs text-slate-400">obiettivo {Math.round(goal.kcal)}</span>
          )}
        </div>

        {goal !== null && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${overGoalKcal ? "bg-red-500" : "bg-brand-500"}`}
              style={{ width: `${overGoalKcal ? 100 : kcalPct}%` }}
            />
          </div>
        )}

        <dl className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 pt-2 text-center text-[11px] text-slate-500">
          <div>
            <dt>Prot.</dt>
            <dd className={`text-sm font-semibold tabular-nums ${proteinColor}`}>
              {Math.round(day.total.protein_g)}g
            </dd>
          </div>
          <div>
            <dt>Carb.</dt>
            <dd className={`text-sm font-semibold tabular-nums ${carbsColor}`}>
              {Math.round(day.total.carbs_g)}g
            </dd>
          </div>
          <div>
            <dt>Grassi</dt>
            <dd className={`text-sm font-semibold tabular-nums ${fatColor}`}>
              {Math.round(day.total.fat_g)}g
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** Week diary: a 7-day grid (kcal + macro totals per day, colored against
 * the active goal), with a checkbox per day feeding a "Copia N giorni…"
 * action bar, plus a per-day ⋯ shortcut into the same `CopyDaysDialog`. */
function WeekPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const start = searchParams.get("start") ?? startOfWeek(todayIso());

  const diary = useWeekDiary(start);
  const { data, isLoading, isError } = diary;
  const unavailable = useOfflineUnavailable(diary);
  const { data: goal } = useGoal();
  const canCopy = useHasPermission("diary.copy");
  const isMonday = startOfWeek(start) === start;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copySourceDates, setCopySourceDates] = useState<string[] | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  function goToWeek(nextStart: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("start", nextStart);
      return next;
    });
    setSelected(new Set());
  }

  function toggleDay(date: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }

  function handleCloseDialog() {
    setCopySourceDates(null);
    setSelected(new Set());
  }

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <button
            type="button"
            aria-label="Settimana precedente"
            onClick={() => goToWeek(shiftIsoDate(start, -7))}
            className="btn-ghost w-11 text-2xl leading-none"
          >
            &lsaquo;
          </button>
          <div className="min-w-0 text-center">
            <h1 className="truncate text-[17px] font-semibold text-slate-900">
              {formatIsoDateShort(start)} &ndash; {formatIsoDateShort(shiftIsoDate(start, 6))}
            </h1>
            <span className="text-xs text-slate-400">Settimana</span>
          </div>
          <button
            type="button"
            aria-label="Settimana successiva"
            onClick={() => goToWeek(shiftIsoDate(start, 7))}
            className="btn-ghost w-11 text-2xl leading-none"
          >
            &rsaquo;
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {unavailable && <OfflineUnavailable />}
        {!unavailable && isLoading && <p className="py-8 text-center text-sm text-slate-500">Caricamento...</p>}
        {!unavailable && isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">
            Errore nel caricamento della settimana.
          </p>
        )}

        {data && (
          <>
            {canCopy && (
              <div className="flex min-h-[44px] items-center justify-between gap-3">
                <Link
                  to="/week/saved"
                  className="flex min-h-[44px] items-center rounded-lg px-3 text-sm font-medium text-brand-700 active:bg-brand-50"
                >
                  Settimane salvate
                </Link>
                {isMonday && (
                  <button
                    type="button"
                    onClick={() => setSaveDialogOpen(true)}
                    className="btn-secondary min-h-[44px]"
                  >
                    Salva settimana
                  </button>
                )}
              </div>
            )}
            <p className="section-label">Seleziona i giorni da copiare</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.days.map((day, index) => (
                <DayCell
                  key={day.date}
                  day={day}
                  index={index}
                  selected={selected.has(day.date)}
                  goal={goal ?? null}
                  onToggle={toggleDay}
                  onCopyDay={(date) => setCopySourceDates([date])}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Floating action bar. It must clear AppShell's fixed tab bar, which
          is painted after it and would otherwise cover the button: offset by
          the shared `--nav-height` (tab bar + iPhone home-indicator safe
          area) rather than a hard-coded height that silently drifts, plus a
          z-index above the nav's as defense in depth. */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[var(--nav-height)] z-40 flex justify-center border-t border-slate-200/80 bg-white/90 p-3 shadow-sheet backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setCopySourceDates(Array.from(selected))}
            className="btn-primary w-full max-w-sm"
          >
            Copia {selected.size} {selected.size === 1 ? "giorno" : "giorni"}&hellip;
          </button>
        </div>
      )}

      {copySourceDates && (
        <CopyDaysDialog sourceDates={copySourceDates} onClose={handleCloseDialog} />
      )}
      {saveDialogOpen && (
        <SaveWeekDialog start={start} onClose={() => setSaveDialogOpen(false)} />
      )}
    </div>
  );
}

export default WeekPage;
