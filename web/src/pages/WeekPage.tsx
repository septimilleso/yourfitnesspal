import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { Goal, WeekDayTotal } from "../api/queries";
import { useGoal, useWeekDiary } from "../api/queries";
import CopyDaysDialog from "../components/CopyDaysDialog";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `iso` (`getDay()` is 0=Sunday..6=Saturday). */
function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return shiftIsoDate(iso, diff);
}

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

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(day.date)}
            aria-label={`Seleziona ${day.date}`}
          />
          <span className="text-xs font-medium text-slate-500">
            {dayLabel(index)} {day.date.slice(5)}
          </span>
        </label>
        <button
          type="button"
          onClick={() => onCopyDay(day.date)}
          aria-label={`Altre azioni ${day.date}`}
          className="rounded px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          &#8943;
        </button>
      </div>

      <div>
        <span className={`text-lg font-bold ${kcalColor}`}>{Math.round(day.total.kcal)}</span>
        <span className="ml-1 text-xs text-slate-400">kcal</span>
      </div>

      <dl className="grid grid-cols-3 gap-1 text-center text-[11px] text-slate-500">
        <div>
          <dt>Prot.</dt>
          <dd className={`font-medium ${proteinColor}`}>{Math.round(day.total.protein_g)}g</dd>
        </div>
        <div>
          <dt>Carb.</dt>
          <dd className={`font-medium ${carbsColor}`}>{Math.round(day.total.carbs_g)}g</dd>
        </div>
        <div>
          <dt>Grassi</dt>
          <dd className={`font-medium ${fatColor}`}>{Math.round(day.total.fat_g)}g</dd>
        </div>
      </dl>
    </div>
  );
}

/** Week diary: a 7-day grid (kcal + macro totals per day, colored against
 * the active goal), with a checkbox per day feeding a "Copia N giorni…"
 * action bar, plus a per-day ⋯ shortcut into the same `CopyDaysDialog`. */
function WeekPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const start = searchParams.get("start") ?? startOfWeek(todayIso());

  const { data, isLoading, isError } = useWeekDiary(start);
  const { data: goal } = useGoal();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copySourceDates, setCopySourceDates] = useState<string[] | null>(null);

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
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <button
          type="button"
          aria-label="Settimana precedente"
          onClick={() => goToWeek(shiftIsoDate(start, -7))}
          className="rounded px-3 py-1 text-xl text-slate-600 hover:bg-slate-100"
        >
          &lsaquo;
        </button>
        <h1 className="text-lg font-bold text-slate-900">
          {start} &ndash; {shiftIsoDate(start, 6)}
        </h1>
        <button
          type="button"
          aria-label="Settimana successiva"
          onClick={() => goToWeek(shiftIsoDate(start, 7))}
          className="rounded px-3 py-1 text-xl text-slate-600 hover:bg-slate-100"
        >
          &rsaquo;
        </button>
      </header>

      {isLoading && <p className="text-center text-slate-500">Caricamento...</p>}
      {isError && <p className="text-center text-red-600">Errore nel caricamento della settimana.</p>}

      {data && (
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
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 flex justify-center bg-white p-3 shadow-[0_-1px_4px_rgba(0,0,0,0.1)]">
          <button
            type="button"
            onClick={() => setCopySourceDates(Array.from(selected))}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Copia {selected.size} {selected.size === 1 ? "giorno" : "giorni"}&hellip;
          </button>
        </div>
      )}

      {copySourceDates && (
        <CopyDaysDialog sourceDates={copySourceDates} onClose={handleCloseDialog} />
      )}
    </div>
  );
}

export default WeekPage;
