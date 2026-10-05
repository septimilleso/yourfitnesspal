import { useSearchParams } from "react-router-dom";

import { todayIso } from "./date";
import {
  type Period,
  type PeriodChoice,
  type Preset,
  PRESETS,
  presetPeriod,
  validateCustomPeriod,
} from "./stats";

function readChoice(params: URLSearchParams): PeriodChoice {
  const from = params.get("from");
  const to = params.get("to");
  if (from !== null || to !== null) return { kind: "custom", from: from ?? "", to: to ?? "" };
  const days = Number(params.get("range"));
  return { kind: "preset", days: (PRESETS as number[]).includes(days) ? (days as Preset) : 7 };
}

/** Shared period selection and query-string handling for statistics pages. */
export function usePeriodParams() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const choice = readChoice(params);
  const error = choice.kind === "custom" ? validateCustomPeriod(choice.from, choice.to, today) : null;
  const period: Period =
    choice.kind === "preset"
      ? presetPeriod(choice.days, today)
      : { start: choice.from, end: choice.to };

  function setPreset(days: Preset) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("from");
        next.delete("to");
        next.set("range", String(days));
        return next;
      },
      { replace: true },
    );
  }

  function openCustom() {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("range");
        next.set("from", period.start);
        next.set("to", period.end);
        return next;
      },
      { replace: true },
    );
  }

  function setDates(from: string, to: string) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("range");
        next.set("from", from);
        next.set("to", to);
        return next;
      },
      { replace: true },
    );
  }

  return { choice, today, error, period, setPreset, openCustom, setDates };
}
