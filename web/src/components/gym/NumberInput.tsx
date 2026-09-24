import { useEffect, useRef, useState } from "react";

import { formatDuration, formatKg, parseDecimal, parseDuration, parseInteger } from "../../lib/gym";

type Kind = "decimal" | "integer" | "duration";

const LIMITS: Record<Kind, number> = { decimal: 1000, integer: 1000, duration: 36000 };

function format(value: number | null, kind: Kind): string {
  if (value === null) return "";
  if (kind === "decimal") return formatKg(value);
  if (kind === "duration") return formatDuration(value);
  return String(value);
}

function parse(text: string, kind: Kind): number | null {
  if (kind === "decimal") return parseDecimal(text);
  if (kind === "duration") return parseDuration(text);
  return parseInteger(text);
}

interface NumberInputProps {
  value: number | null;
  kind: Kind;
  onChange: (value: number | null) => void;
  onBlur?: () => void;
  /** Accessible name, e.g. "kg serie 1". */
  label: string;
  placeholder?: string;
}

/** Grey pill input used for kg / reps / time. Keeps the typed text while
 * focused (so "37," can become "37,5") and re-formats on blur. */
function NumberInput({ value, kind, onChange, onBlur, label, placeholder }: NumberInputProps) {
  const [text, setText] = useState(() => format(value, kind));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value, kind));
  }, [value, kind]);

  return (
    <input
      aria-label={label}
      inputMode={kind === "integer" ? "numeric" : kind === "decimal" ? "decimal" : "text"}
      placeholder={placeholder}
      value={text}
      onFocus={(event) => {
        focused.current = true;
        event.target.select();
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim() === "") {
          onChange(null);
          return;
        }
        const parsed = parse(next, kind);
        if (parsed !== null && parsed <= LIMITS[kind]) onChange(parsed);
      }}
      onBlur={() => {
        focused.current = false;
        setText(format(value, kind));
        onBlur?.();
      }}
      className="h-9 w-full min-w-0 rounded-lg bg-slate-100 text-center text-[16px] font-semibold tabular-nums text-slate-900 placeholder:text-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/40"
    />
  );
}

export default NumberInput;
