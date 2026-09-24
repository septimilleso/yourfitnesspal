import { useTemplate } from "../../api/gym";
import Sheet from "./Sheet";

interface TemplatePreviewSheetProps {
  templateId: number;
  starting: boolean;
  onStart: (templateId: number) => void;
  onEdit: (templateId: number) => void;
  onClose: () => void;
}

function TemplatePreviewSheet({ templateId, starting, onStart, onEdit, onClose }: TemplatePreviewSheetProps) {
  const { data, isLoading } = useTemplate(templateId);
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
          onClick={() => onStart(templateId)}
        >
          Inizia allenamento
        </button>
      }
    >
      {isLoading && <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>}
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
