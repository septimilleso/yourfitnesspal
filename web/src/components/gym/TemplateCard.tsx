import type { TemplateSummary } from "../../api/gym";
import { lastUsedLabel } from "../../lib/gym";
import ActionMenu from "./ActionMenu";

interface TemplateCardProps {
  template: TemplateSummary;
  onOpen: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onMove: () => void;
  onDelete: () => void;
}

function TemplateCard({ template, onOpen, onEdit, onDuplicate, onMove, onDelete }: TemplateCardProps) {
  const lastUsed = lastUsedLabel(template.last_used_at);
  return (
    <div className="card flex min-h-[9.5rem] flex-col p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 text-left text-[17px] font-semibold leading-tight text-slate-900"
        >
          {template.name}
        </button>
        <ActionMenu
          label={`Azioni ${template.name}`}
          actions={[
            { label: "Modifica", onSelect: onEdit },
            { label: "Duplica", onSelect: onDuplicate },
            { label: "Sposta in cartella", onSelect: onMove },
            { label: "Elimina", onSelect: onDelete, destructive: true },
          ]}
        />
      </div>
      <button type="button" onClick={onOpen} tabIndex={-1} className="mt-1 flex-1 text-left">
        <p className="line-clamp-3 text-[14px] leading-snug text-slate-500">
          {template.exercise_names.join(", ") || "Nessun esercizio"}
        </p>
      </button>
      {lastUsed && (
        <p className="mt-2 flex items-center gap-1 text-xs italic text-slate-500">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
            <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 10.4 3 1.8-.8 1.3-3.7-2.2V7h1.5v5.4Z" />
          </svg>
          {lastUsed}
        </p>
      )}
    </div>
  );
}

export default TemplateCard;
