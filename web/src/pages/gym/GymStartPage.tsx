import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Folder, TemplateSummary } from "../../api/gym";
import {
  useActiveWorkout,
  useCreateFolder,
  useDeleteFolder,
  useDeleteTemplate,
  useDuplicateTemplate,
  usePatchTemplate,
  useRenameFolder,
  useStartWorkout,
  useTemplates,
} from "../../api/gym";
import ModeSwitch from "../../components/ModeSwitch";
import OfflineUnavailable from "../../components/OfflineUnavailable";
import ActionMenu from "../../components/gym/ActionMenu";
import MoveToFolderSheet from "../../components/gym/MoveToFolderSheet";
import TemplateCard from "../../components/gym/TemplateCard";
import TemplatePreviewSheet from "../../components/gym/TemplatePreviewSheet";
import { mascot } from "../../lib/art";
import { useOfflineUnavailable } from "../../lib/useOfflineUnavailable";

const folderIcon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);

/** "Inizia": start an empty workout or one from a template; templates are
 * grouped in collapsible folders (like Strong's "Modelli"). */
function GymStartPage() {
  const navigate = useNavigate();
  const templates = useTemplates();
  const templatesUnavailable = useOfflineUnavailable(templates);
  const active = useActiveWorkout();
  const start = useStartWorkout();
  const createFolder = useCreateFolder();
  const renameFolder = useRenameFolder();
  const deleteFolder = useDeleteFolder();
  const duplicate = useDuplicateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const patchTemplate = usePatchTemplate();
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<number[]>([]);

  function startWorkout(templateId: number | null) {
    if (active.data) {
      if (window.confirm("C'è già un allenamento in corso. Vuoi riprenderlo?")) navigate("/gym/workout");
      return;
    }
    start.mutate(templateId, { onSuccess: () => navigate("/gym/workout") });
  }

  function newFolder() {
    const name = window.prompt("Nome della cartella")?.trim();
    if (name) createFolder.mutate(name);
  }

  function renameFolderPrompt(folder: Folder) {
    const name = window.prompt("Nuovo nome della cartella", folder.name)?.trim();
    if (name && name !== folder.name) renameFolder.mutate({ id: folder.id, name });
  }

  function removeFolder(folder: Folder) {
    if (window.confirm(`Eliminare la cartella "${folder.name}"? I modelli restano.`)) {
      deleteFolder.mutate(folder.id);
    }
  }

  function removeTemplate(template: TemplateSummary) {
    if (window.confirm(`Eliminare il modello "${template.name}"?`)) deleteTemplate.mutate(template.id);
  }

  function toggle(folderId: number) {
    setCollapsed((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId],
    );
  }

  function cards(list: TemplateSummary[]) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {list.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onOpen={() => setPreviewId(template.id)}
            onEdit={() => navigate(`/gym/templates/${template.id}`)}
            onDuplicate={() => duplicate.mutate(template.id)}
            onMove={() => setMovingId(template.id)}
            onDelete={() => removeTemplate(template)}
          />
        ))}
      </div>
    );
  }

  const data = templates.data;
  const loose = data?.templates.filter((template) => template.folder_id === null) ?? [];
  const moving = data?.templates.find((template) => template.id === movingId);

  return (
    <div>
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3 text-center">
          <h1 className="text-[17px] font-semibold text-slate-900">Inizia allenamento</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-5 p-4">
        <button
          type="button"
          className="btn-primary w-full bg-sky-500 active:bg-sky-600"
          onClick={() => startWorkout(null)}
          disabled={start.isPending}
        >
          {active.data ? "Riprendi allenamento" : "Inizia un allenamento vuoto"}
        </button>

        <div className="flex items-center justify-between gap-2">
          <h2 className="text-2xl font-bold text-slate-900">Modelli</h2>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-3 text-sky-600" onClick={() => navigate("/gym/templates/new")}>
              + Modello
            </button>
            <button type="button" className="btn-secondary px-3 text-sky-600" aria-label="Nuova cartella" onClick={newFolder}>
              {folderIcon}
            </button>
          </div>
        </div>

        {templatesUnavailable && <OfflineUnavailable />}
        {!templatesUnavailable && templates.isLoading && (
          <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>
        )}
        {!templatesUnavailable && templates.isError && (
          <p className="card px-4 py-3 text-center text-sm text-red-600">Errore nel caricamento dei modelli.</p>
        )}

        {data?.folders.map((folder) => {
          const list = data.templates.filter((template) => template.folder_id === folder.id);
          const isCollapsed = collapsed.includes(folder.id);
          return (
            <section key={folder.id} className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(folder.id)}
                  className="flex min-w-0 items-center gap-2 text-[17px] font-semibold text-slate-800"
                >
                  {folderIcon}
                  <span className="truncate">
                    {folder.name} ({list.length})
                  </span>
                </button>
                <ActionMenu
                  label={`Azioni cartella ${folder.name}`}
                  actions={[
                    { label: "Rinomina", onSelect: () => renameFolderPrompt(folder) },
                    { label: "Elimina cartella", onSelect: () => removeFolder(folder), destructive: true },
                  ]}
                />
              </div>
              {!isCollapsed &&
                (list.length ? cards(list) : <p className="text-sm text-slate-500">Cartella vuota</p>)}
            </section>
          );
        })}

        {loose.length > 0 && (
          <section className="space-y-3">
            {data && data.folders.length > 0 && <h3 className="section-label">Altri modelli</h3>}
            {cards(loose)}
          </section>
        )}

        {data && data.templates.length === 0 && (
          <div className="card px-4 py-6 text-center">
            <img
              src={mascot("gym")}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="mx-auto mb-3 h-[120px] w-auto object-contain"
            />
            <p className="text-sm text-slate-500">Nessun modello. Crea il primo con "+ Modello".</p>
          </div>
        )}
      </div>

      {previewId !== null && (
        <TemplatePreviewSheet
          templateId={previewId}
          starting={start.isPending}
          onClose={() => setPreviewId(null)}
          onStart={(id) => startWorkout(id)}
          onEdit={(id) => navigate(`/gym/templates/${id}`)}
        />
      )}
      {moving && data && (
        <MoveToFolderSheet
          folders={data.folders}
          currentFolderId={moving.folder_id}
          onClose={() => setMovingId(null)}
          onPick={(folderId) => {
            patchTemplate.mutate({ id: moving.id, folder_id: folderId });
            setMovingId(null);
          }}
        />
      )}
    </div>
  );
}

export default GymStartPage;
