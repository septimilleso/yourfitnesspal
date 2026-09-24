import type { ExerciseFilters } from "../../api/gym";
import { EQUIPMENT_LABELS, MUSCLE_LABELS } from "../../lib/gym";

interface ExerciseFilterBarProps {
  value: ExerciseFilters;
  onChange: (next: ExerciseFilters) => void;
}

function ExerciseFilterBar({ value, onChange }: ExerciseFilterBarProps) {
  return (
    <div className="space-y-2">
      <input
        type="search"
        aria-label="Cerca esercizio"
        placeholder="Cerca esercizio (nome inglese)"
        className="field"
        value={value.q}
        onChange={(event) => onChange({ ...value, q: event.target.value })}
      />
      <div className="flex gap-2">
        <select
          aria-label="Attrezzo"
          className="field"
          value={value.equipment}
          onChange={(event) => onChange({ ...value, equipment: event.target.value })}
        >
          <option value="">Tutti gli attrezzi</option>
          {Object.entries(EQUIPMENT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Muscolo"
          className="field"
          value={value.muscle}
          onChange={(event) => onChange({ ...value, muscle: event.target.value })}
        >
          <option value="">Tutti i muscoli</option>
          {Object.entries(MUSCLE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default ExerciseFilterBar;
