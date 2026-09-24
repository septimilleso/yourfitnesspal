import { REST_OPTIONS, restLabel } from "../../lib/gym";
import Sheet from "./Sheet";

interface RestPickerProps {
  value: number;
  onChange: (seconds: number) => void;
  onClose: () => void;
  title?: string;
}

function RestPicker({ value, onChange, onClose, title = "Riposo" }: RestPickerProps) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="grid grid-cols-4 gap-2">
        {REST_OPTIONS.map((seconds) => (
          <button
            key={seconds}
            type="button"
            aria-pressed={seconds === value}
            onClick={() => onChange(seconds)}
            className={`rounded-lg py-2 text-[15px] font-semibold tabular-nums ${
              seconds === value ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 active:bg-slate-200"
            }`}
          >
            {restLabel(seconds)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export default RestPicker;
