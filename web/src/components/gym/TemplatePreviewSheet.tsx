import { type Template, useTemplate } from "../../api/gym";
import { useOfflineUnavailable } from "../../lib/useOfflineUnavailable";
import OfflineUnavailable from "../OfflineUnavailable";
import Sheet from "./Sheet";

interface TemplatePreviewSheetProps {
  templateId: number;
  starting: boolean;
  /** Riceve il modello caricato: l'avvio nell'IPA ne copia esercizi e serie senza altre richieste. */
  onStart: (template: Template) => void;
  onEdit: (templateId: number) => void;
  onClose: () => void;
}

function TemplatePreviewSheet({ templateId, starting, onStart, onEdit, onClose }: TemplatePreviewSheetProps) {
  const template = useTemplate(templateId);
  const { data, isLoading } = template;
  const unavailable = useOfflineUnavailable(template);
  return (
    <Sheet
      title={data?.name ?? "Modello"}
      onClose={onClose}
      headerAction={
        <button type="button" className="btn-ghost text-sky-600" onClick={() => onEdit(templateId)}>
          Modifica
        </button>
      }
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={starting || !data}
          onClick={() => {
            if (data) onStart(data);
          }}
        >
          Inizia allenamento
        </button>
      }
    >
      {unavailable && <OfflineUnavailable compact />}
      {!unavailable && isLoading && <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>}
      {data && (
        <ul className="card divide-y divide-slate-100">
          {data.exercises.map((item) => (
            <li key={item.id} className="row">
              <span className="w-10 shrink-0 font-semibold tabular-nums text-slate-500">
                {item.sets.length} ×
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] text-slate-900">
                {item.exercise.name}
              </span>
              {item.superset_group !== null && (
                <span className="text-xs font-semibold uppercase text-sky-600">Superserie</span>
              )}
            </li>
          ))}
          {data.exercises.length === 0 && (
            <li className="row text-sm text-slate-500">Nessun esercizio</li>
          )}
        </ul>
      )}
    </Sheet>
  );
}

export default TemplatePreviewSheet;
