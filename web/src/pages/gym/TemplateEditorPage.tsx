import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { Exercise, SetValues, Template, TemplateInput } from "../../api/gym";
import { useCreateTemplate, useReplaceTemplate, useTemplate, useTemplates } from "../../api/gym";
import ActionMenu, { type Action } from "../../components/gym/ActionMenu";
import ExercisePicker from "../../components/gym/ExercisePicker";
import NumberInput from "../../components/gym/NumberInput";
import RestPicker from "../../components/gym/RestPicker";
import {
  exerciseSubtitle,
  FIELD_META,
  linkWithNext,
  moveItem,
  restLabel,
  setFields,
  unlinkFromGroup,
} from "../../lib/gym";

interface DraftExercise {
  key: string;
  exercise: Exercise;
  rest_seconds: number;
  superset_group: number | null;
  note: string | null;
  sets: SetValues[];
}

let keySequence = 0;
const nextKey = () => `draft-${(keySequence += 1)}`;
const emptySet = (): SetValues => ({ weight_kg: null, reps: null, duration_s: null });

function toDraft(template: Template): DraftExercise[] {
  return template.exercises.map((item) => ({
    key: nextKey(),
    exercise: item.exercise,
    rest_seconds: item.rest_seconds,
    superset_group: item.superset_group,
    note: item.note,
    sets: item.sets.map((set) => ({ ...set })),
  }));
}

/** Create or edit a template. Edits stay in a local draft; "Salva" sends the
 * whole template in one request (POST for new, PUT for existing). */
function TemplateEditorPage() {
  const { id } = useParams();
  const templateId = id ? Number(id) : null;
  const navigate = useNavigate();
  const existing = useTemplate(templateId);
  const templates = useTemplates();
  const create = useCreateTemplate();
  const replace = useReplaceTemplate();
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState<number | null>(null);
  const [items, setItems] = useState<DraftExercise[]>([]);
  const [loaded, setLoaded] = useState(templateId === null);
  const [picking, setPicking] = useState(false);
  const [restFor, setRestFor] = useState<string | null>(null);

  useEffect(() => {
    if (existing.data && !loaded) {
      setName(existing.data.name);
      setFolderId(existing.data.folder_id);
      setItems(toDraft(existing.data));
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  function update(key: string, patch: Partial<DraftExercise>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function updateSet(key: string, index: number, patch: Partial<SetValues>) {
    setItems((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, sets: item.sets.map((set, n) => (n === index ? { ...set, ...patch } : set)) }
          : item,
      ),
    );
  }

  function addSet(key: string) {
    setItems((current) =>
      current.map((item) =>
        item.key === key
          ? { ...item, sets: [...item.sets, { ...(item.sets[item.sets.length - 1] ?? emptySet()) }] }
          : item,
      ),
    );
  }

  function removeSet(key: string, index: number) {
    setItems((current) =>
      current.map((item) =>
        item.key === key && item.sets.length > 1
          ? { ...item, sets: item.sets.filter((_, n) => n !== index) }
          : item,
      ),
    );
  }

  function setGroups(groups: (number | null)[]) {
    setItems((current) => current.map((item, n) => ({ ...item, superset_group: groups[n] })));
  }

  function addExercises(list: Exercise[]) {
    setItems((current) => [
      ...current,
      ...list.map((exercise) => ({
        key: nextKey(),
        exercise,
        rest_seconds: 90,
        superset_group: null,
        note: null,
        sets: [emptySet()],
      })),
    ]);
    setPicking(false);
  }

  function actionsFor(item: DraftExercise, index: number): Action[] {
    const groups = items.map((entry) => entry.superset_group);
    const actions: Action[] = [{ label: "Riposo", onSelect: () => setRestFor(item.key) }];
    if (index > 0) actions.push({ label: "Sposta su", onSelect: () => setItems(moveItem(items, index, -1)) });
    if (index < items.length - 1) {
      actions.push({ label: "Sposta giù", onSelect: () => setItems(moveItem(items, index, 1)) });
      actions.push({ label: "Collega al successivo", onSelect: () => setGroups(linkWithNext(groups, index)) });
    }
    if (item.superset_group !== null) {
      actions.push({ label: "Scollega superserie", onSelect: () => setGroups(unlinkFromGroup(groups, index)) });
    }
    actions.push({
      label: "Rimuovi esercizio",
      destructive: true,
      onSelect: () => setItems((current) => current.filter((entry) => entry.key !== item.key)),
    });
    return actions;
  }

  const saving = create.isPending || replace.isPending;
  const canSave = loaded && name.trim().length > 0 && !saving;

  function save() {
    const input: TemplateInput = {
      name: name.trim(),
      folder_id: folderId,
      exercises: items.map((item) => ({
        exercise_id: item.exercise.id,
        rest_seconds: item.rest_seconds,
        superset_group: item.superset_group,
        note: item.note,
        sets: item.sets,
      })),
    };
    const options = { onSuccess: () => navigate("/gym") };
    if (templateId === null) create.mutate(input, options);
    else replace.mutate({ id: templateId, input }, options);
  }

  const restItem = items.find((item) => item.key === restFor);

  return (
    <div>
      <header className="app-header">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-2 py-2">
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>
            Annulla
          </button>
          <h1 className="text-[17px] font-semibold text-slate-900">
            {templateId === null ? "Nuovo modello" : "Modifica modello"}
          </h1>
          <button type="button" className="btn-ghost font-semibold text-sky-600" disabled={!canSave} onClick={save}>
            Salva
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        {!loaded && <p className="py-6 text-center text-sm text-slate-500">Caricamento...</p>}
        {(create.isError || replace.isError) && (
          <p className="card px-4 py-3 text-sm text-red-600">Salvataggio non riuscito.</p>
        )}

        <div className="card space-y-3 p-4">
          <div>
            <label htmlFor="template-name" className="field-label">
              Nome del modello
            </label>
            <input
              id="template-name"
              className="field mt-1.5"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="template-folder" className="field-label">
              Cartella
            </label>
            <select
              id="template-folder"
              className="field mt-1.5"
              value={folderId ?? ""}
              onChange={(event) => setFolderId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Nessuna cartella</option>
              {templates.data?.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {items.map((item, index) => {
          const fields = setFields(item.exercise.tracking);
          return (
            <section
              key={item.key}
              aria-label={item.exercise.name}
              className={`card p-3 ${item.superset_group !== null ? "border-l-4 border-l-sky-400" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-[17px] font-semibold text-sky-600">{item.exercise.name}</h2>
                  <p className="truncate text-[13px] text-slate-500">
                    {exerciseSubtitle(item.exercise)}
                    {item.superset_group !== null && " · Superserie"}
                  </p>
                </div>
                <ActionMenu label={`Azioni ${item.exercise.name}`} actions={actionsFor(item, index)} />
              </div>

              <div
                className="mt-3 grid items-center gap-2 text-center text-[13px] font-semibold text-slate-600"
                style={{ gridTemplateColumns: `2.25rem repeat(${fields.length}, minmax(0,1fr)) 2.25rem` }}
              >
                <span>Serie</span>
                {fields.map((field) => (
                  <span key={field}>{FIELD_META[field].label}</span>
                ))}
                <span />
                {item.sets.map((set, n) => (
                  <div key={n} className="contents">
                    <span className="rounded-lg bg-slate-100 py-1.5 text-[15px] text-slate-700">{n + 1}</span>
                    {fields.map((field) => (
                      <NumberInput
                        key={field}
                        label={`${FIELD_META[field].label} serie ${n + 1}`}
                        kind={FIELD_META[field].kind}
                        value={set[field]}
                        onChange={(value) => updateSet(item.key, n, { [field]: value } as Partial<SetValues>)}
                      />
                    ))}
                    <button
                      type="button"
                      aria-label={`Elimina serie ${n + 1}`}
                      disabled={item.sets.length === 1}
                      onClick={() => removeSet(item.key, n)}
                      className="text-xl text-slate-400 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => addSet(item.key)}
                className="mt-2 w-full rounded-lg bg-slate-100 py-2 text-[15px] font-semibold text-slate-700 active:bg-slate-200"
              >
                + Aggiungi serie
              </button>
              <button
                type="button"
                onClick={() => setRestFor(item.key)}
                className="mt-2 w-full text-center text-[13px] font-semibold text-sky-600"
              >
                Riposo {restLabel(item.rest_seconds)}
              </button>
            </section>
          );
        })}

        <button type="button" className="btn-secondary w-full text-sky-600" onClick={() => setPicking(true)}>
          + Aggiungi esercizio
        </button>
      </div>

      {picking && <ExercisePicker onPick={addExercises} onClose={() => setPicking(false)} />}
      {restItem && (
        <RestPicker
          value={restItem.rest_seconds}
          onClose={() => setRestFor(null)}
          onChange={(seconds) => {
            update(restItem.key, { rest_seconds: seconds });
            setRestFor(null);
          }}
        />
      )}
    </div>
  );
}

export default TemplateEditorPage;
