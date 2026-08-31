# Modifica e spostamento di una entry del diario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dalla Day page, toccare un alimento già registrato apre un bottom sheet per cambiarne i grammi e spostarlo tra Colazione / Pranzo / Cena / Spuntino con un solo salvataggio.

**Architecture:** Feature solo frontend. Il backend (`PATCH /api/diary/entries/{id}`) e l'hook `usePatchEntry` esistono già e non cambiano. Si aggiunge un nuovo componente `EditEntrySheet` (modellato su `QuantityPicker`), si rende toccabile l'area nome di `FoodRow`, e `DayPage` tiene lo stato "quale entry sto modificando".

**Tech Stack:** React 18 + TypeScript, Vite, `@tanstack/react-query`, Tailwind, vitest + `@testing-library/react` + `@testing-library/user-event`.

## Global Constraints

- Tutto il codice web è in `web/`; i comandi si lanciano da `web/`.
- Test: `npm test` (vitest). Type-check/build: `npm run build` (`tsc -b && vite build`). Lint: da `web/`, `npx eslint src`.
- Label pasti in italiano, esattamente: `Colazione`, `Pranzo`, `Cena`, `Spuntino`.
- Chiavi `Meal`: `"breakfast" | "lunch" | "dinner" | "snack"`; l'array canonico è `MEALS` in `web/src/api/queries.ts`.
- Nessun optimistic update: si usa lo stesso pattern di `useDeleteEntry` (invalidazione su `onSettled`).
- Le classi utility `field`, `field-label`, `btn-primary`, `btn-secondary`, `rounded-sheet`, `rounded-t-sheet`, `shadow-sheet`, `--safe-bottom` esistono già in `web/src/index.css` (le usa `QuantityPicker`).
- `scalePreview(nutriments, grams)` è già esportata da `web/src/components/QuantityPicker.tsx`.

---

## File Structure

- **Create** `web/src/lib/meals.ts` — mappa `MEAL_LABELS: Record<Meal, string>`, unica fonte delle label italiane, importabile da più componenti.
- **Modify** `web/src/components/MealSection.tsx` — importa `MEAL_LABELS` da `../lib/meals` invece di definirlo inline; aggiunge la prop `onEdit` e la passa a `FoodRow`.
- **Create** `web/src/components/EditEntrySheet.tsx` — bottom sheet di modifica (grammi + pasto + preview macro), usa `usePatchEntry`.
- **Create** `web/src/components/EditEntrySheet.test.tsx` — test del componente.
- **Modify** `web/src/components/FoodRow.tsx` — aggiunge la prop `onEdit`; l'area nome/dettaglio diventa un `<button>`.
- **Create** `web/src/components/FoodRow.test.tsx` — test del comportamento tap/delete della riga.
- **Modify** `web/src/pages/DayPage.tsx` — stato `editing: DiaryEntry | null`, monta `EditEntrySheet`.
- **Modify** `web/src/pages/DayPage.test.tsx` — test apertura/chiusura sheet.

---

## Task 1: Estrarre `MEAL_LABELS` in `web/src/lib/meals.ts`

**Files:**
- Create: `web/src/lib/meals.ts`
- Modify: `web/src/components/MealSection.tsx:6-11` (rimozione della costante inline + import)
- Test: nessun test nuovo (rifattorizzazione; coperta da `DayPage.test.tsx` che verifica le label rese)

**Interfaces:**
- Consumes: `Meal` da `../api/queries`.
- Produces: `export const MEAL_LABELS: Record<Meal, string>` da `web/src/lib/meals.ts`.

- [ ] **Step 1: Creare `web/src/lib/meals.ts`**

```ts
import type { Meal } from "../api/queries";

/** Label italiane dei 4 slot pasto. Unica fonte: sia `MealSection` sia
 * `EditEntrySheet` la importano, così i due elenchi non divergono. */
export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Colazione",
  lunch: "Pranzo",
  dinner: "Cena",
  snack: "Spuntino",
};
```

- [ ] **Step 2: Aggiornare `MealSection.tsx` per importarla**

In `web/src/components/MealSection.tsx`: rimuovere la dichiarazione locale `const MEAL_LABELS: Record<Meal, string> = { ... };` (righe 6-11) e aggiungere in cima agli import:

```ts
import { MEAL_LABELS } from "../lib/meals";
```

Lasciare `MEAL_ICONS` dov'è. Se dopo la rimozione il tipo `Meal` non è più usato altrove nel file, ESLint segnalerà l'import inutilizzato: in tal caso togliere `Meal` dall'import `import type { DiaryEntry, Meal } from "../api/queries";` lasciando `DiaryEntry`.

- [ ] **Step 3: Type-check + test**

Run (da `web/`): `npm run build && npm test`
Expected: build OK; tutti i test verdi (incl. `DayPage.test.tsx` che verifica `Colazione/Pranzo/Cena/Spuntino`).

- [ ] **Step 4: Lint**

Run (da `web/`): `npx eslint src/lib/meals.ts src/components/MealSection.tsx`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/meals.ts web/src/components/MealSection.tsx
git commit -m "refactor(web): extract MEAL_LABELS into lib/meals"
```

---

## Task 2: Componente `EditEntrySheet`

**Files:**
- Create: `web/src/components/EditEntrySheet.tsx`
- Test: `web/src/components/EditEntrySheet.test.tsx`

**Interfaces:**
- Consumes:
  - `MEAL_LABELS` da `../lib/meals` (Task 1).
  - `scalePreview` da `./QuantityPicker` (già esistente).
  - `usePatchEntry`, `MEALS`, tipi `DiaryEntry`, `Meal` da `../api/queries` (già esistenti). `usePatchEntry().mutate` accetta `{ id: number; grams?: number; meal?: Meal }` e chiama internamente `client.patch("/diary/entries/{id}", { grams, meal })`.
- Produces:
  - `export default function EditEntrySheet(props: { entry: DiaryEntry; onClose: () => void }): JSX.Element`

- [ ] **Step 1: Scrivere il test che fallisce**

Create `web/src/components/EditEntrySheet.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { client } from "../api/client";
import type { DiaryEntry } from "../api/queries";
import EditEntrySheet from "./EditEntrySheet";

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    client: { ...actual.client, patch: vi.fn() },
  };
});

const entry: DiaryEntry = {
  id: 7,
  food_id: 100,
  food_name: "Yogurt greco",
  food_brand: "Fage",
  date: "2026-08-26",
  meal: "breakfast",
  grams: 200,
  portion_label: null,
  position: 0,
  nutriments_snapshot: {
    kcal: 80,
    protein_g: 4,
    carbs_g: 10,
    sugars_g: 2,
    fat_g: 2,
    sat_fat_g: 1,
    fiber_g: 1,
    salt_g: 0.1,
  },
};

function renderSheet(overrides: Partial<React.ComponentProps<typeof EditEntrySheet>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <EditEntrySheet entry={entry} onClose={onClose} {...overrides} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe("EditEntrySheet", () => {
  it("prefills grams and the current meal, and shows the scaled preview", () => {
    renderSheet();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    expect(input.value).toBe("200");
    // 80 kcal/100g * 200g = 160
    expect(screen.getByText("160")).toBeInTheDocument();
    // current meal pill is pressed
    expect(screen.getByRole("button", { name: "Colazione" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("rescales the macro preview when grams change", async () => {
    const user = userEvent.setup();
    renderSheet();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    await user.clear(input);
    await user.type(input, "300");

    // 80 * 300 / 100 = 240
    expect(screen.getByText("240")).toBeInTheDocument();
  });

  it("selects another meal pill", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("button", { name: "Cena" }));

    expect(screen.getByRole("button", { name: "Cena" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Colazione" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("patches the entry with id, grams and meal, then calls onClose", async () => {
    vi.mocked(client.patch).mockResolvedValue({});
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    await user.clear(input);
    await user.type(input, "250");
    await user.click(screen.getByRole("button", { name: "Pranzo" }));
    await user.click(screen.getByRole("button", { name: /salva/i }));

    expect(client.patch).toHaveBeenCalledWith("/diary/entries/7", {
      grams: 250,
      meal: "lunch",
    });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("disables Salva and shows an error when grams is 0 or negative", async () => {
    const user = userEvent.setup();
    renderSheet();

    const input = screen.getByLabelText<HTMLInputElement>(/grammi/i);
    await user.clear(input);
    await user.type(input, "0");

    expect(screen.getByRole("alert")).toHaveTextContent(/quantità valida/i);
    expect(screen.getByRole("button", { name: /salva/i })).toBeDisabled();

    fireEvent.change(input, { target: { value: "-5" } });
    expect(screen.getByRole("button", { name: /salva/i })).toBeDisabled();
  });

  it("shows an error and keeps the sheet open when the patch fails", async () => {
    vi.mocked(client.patch).mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    await user.click(screen.getByRole("button", { name: /salva/i }));

    expect(await screen.findByText(/errore durante il salvataggio/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Annulla is clicked", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();

    await user.click(screen.getByRole("button", { name: /annulla/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run (da `web/`): `npm test -- EditEntrySheet`
Expected: FAIL — `Failed to resolve import "./EditEntrySheet"` / componente inesistente.

- [ ] **Step 3: Implementare `EditEntrySheet.tsx`**

Create `web/src/components/EditEntrySheet.tsx`:

```tsx
import { useState } from "react";

import type { DiaryEntry, Meal } from "../api/queries";
import { MEALS, usePatchEntry } from "../api/queries";
import { MEAL_LABELS } from "../lib/meals";
import { scalePreview } from "./QuantityPicker";

interface EditEntrySheetProps {
  entry: DiaryEntry;
  onClose: () => void;
}

/** Sheet di modifica di una entry già registrata: cambia i grammi e/o
 * sposta l'alimento tra i 4 pasti, con un unico PATCH.
 *
 * Modellato su `QuantityPicker` (stesso overlay, grabber, footer
 * safe-area), ma parte da valori esistenti e non ha i preset "Porzione":
 * lo snapshot dell'entry non porta `serving_size_g`. La preview macro è
 * calcolata dallo snapshot dell'entry, non da un food live. */
function EditEntrySheet({ entry, onClose }: EditEntrySheetProps) {
  const [grams, setGrams] = useState<number>(entry.grams);
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const patchEntry = usePatchEntry();

  const preview = scalePreview(entry.nutriments_snapshot, grams || 0);
  const gramsInvalid = !(grams > 0);
  const canSave = grams > 0 && !patchEntry.isPending;
  const label = entry.food_name || `Alimento #${entry.food_id}`;

  function handleSave() {
    if (!canSave) return;
    patchEntry.mutate({ id: entry.id, grams, meal }, { onSuccess: () => onClose() });
  }

  return (
    <div
      role="dialog"
      aria-label={`Modifica ${label}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-t-sheet bg-white shadow-sheet sm:rounded-sheet">
        <div className="flex justify-center pt-2 sm:hidden">
          <span aria-hidden className="h-1.5 w-10 rounded-full bg-slate-300" />
        </div>

        <div className="border-b border-slate-100 px-5 pb-3 pt-3">
          <h2 className="text-[17px] font-semibold text-slate-900">{label}</h2>
          {entry.food_brand && <p className="text-[13px] text-slate-500">{entry.food_brand}</p>}
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <span className="field-label">Pasto</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {MEALS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={meal === m}
                  onClick={() => setMeal(m)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    meal === m
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-slate-300 text-slate-700 active:bg-slate-100"
                  }`}
                >
                  {MEAL_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="edit-grams" className="field-label">
              Grammi
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="edit-grams"
                type="number"
                inputMode="numeric"
                min={0}
                value={grams}
                onChange={(e) => setGrams(Number(e.target.value))}
                className="field flex-1"
              />
              <button
                type="button"
                onClick={() => setGrams(100)}
                className="shrink-0 rounded-full border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 active:bg-slate-100"
              >
                100 g
              </button>
            </div>
            {gramsInvalid && (
              <p role="alert" className="mt-1.5 text-sm text-red-600">
                Inserisci una quantità valida (maggiore di 0).
              </p>
            )}
          </div>

          <dl className="grid grid-cols-4 divide-x divide-slate-200 rounded-xl bg-slate-50 py-3 text-center">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">kcal</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-slate-900">
                {Math.round(preview.kcal)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Prot.</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-slate-900">
                {preview.protein_g.toFixed(1)} g
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Carb.</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-slate-900">
                {preview.carbs_g.toFixed(1)} g
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Grassi</dt>
              <dd className="text-[15px] font-semibold tabular-nums text-slate-900">
                {preview.fat_g.toFixed(1)} g
              </dd>
            </div>
          </dl>

          {patchEntry.isError && (
            <p role="alert" className="text-sm text-red-600">
              Errore durante il salvataggio delle modifiche.
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 pt-3 pb-[calc(0.75rem+var(--safe-bottom))]">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Annulla
          </button>
          <button type="button" onClick={handleSave} disabled={!canSave} className="btn-primary flex-1">
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}

export default EditEntrySheet;
```

Note per l'implementatore:
- Il test "shows an error when grams is 0" ha sia il `<p role="alert">` dei grammi sia (potenzialmente) quello dell'errore patch. Con patch non ancora invocato, `patchEntry.isError` è `false`, quindi c'è un solo `alert`: `getByRole("alert")` è corretto.
- Il test di errore patch cerca il testo `/errore durante il salvataggio/i`, che corrisponde a "Errore durante il salvataggio delle modifiche.".

- [ ] **Step 4: Lanciare i test e verificare che passino**

Run (da `web/`): `npm test -- EditEntrySheet`
Expected: PASS (7 test).

- [ ] **Step 5: Type-check + lint**

Run (da `web/`): `npm run build && npx eslint src/components/EditEntrySheet.tsx src/components/EditEntrySheet.test.tsx`
Expected: nessun errore.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/EditEntrySheet.tsx web/src/components/EditEntrySheet.test.tsx
git commit -m "feat(web): EditEntrySheet — change grams and move a logged entry between meals"
```

---

## Task 3: `FoodRow` — area nome toccabile

**Files:**
- Modify: `web/src/components/FoodRow.tsx`
- Test: `web/src/components/FoodRow.test.tsx` (create)

**Interfaces:**
- Consumes: `DiaryEntry` da `../api/queries`.
- Produces: `FoodRowProps` guadagna `onEdit: (entry: DiaryEntry) => void`. `MealSection` (Task 4) passerà questa prop.

- [ ] **Step 1: Scrivere il test che fallisce**

Create `web/src/components/FoodRow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DiaryEntry } from "../api/queries";
import FoodRow from "./FoodRow";

const entry: DiaryEntry = {
  id: 3,
  food_id: 100,
  food_name: "Pasta integrale",
  food_brand: null,
  date: "2026-08-26",
  meal: "lunch",
  grams: 150,
  portion_label: null,
  position: 0,
  nutriments_snapshot: {
    kcal: 350,
    protein_g: 12,
    carbs_g: 70,
    sugars_g: 3,
    fat_g: 2,
    sat_fat_g: 0.5,
    fiber_g: 6,
    salt_g: 0.02,
  },
};

function renderRow(overrides: Partial<React.ComponentProps<typeof FoodRow>> = {}) {
  const onDelete = vi.fn();
  const onEdit = vi.fn();
  render(
    <ul>
      <FoodRow entry={entry} onDelete={onDelete} onEdit={onEdit} {...overrides} />
    </ul>,
  );
  return { onDelete, onEdit };
}

describe("FoodRow", () => {
  it("calls onEdit with the entry when the name area is tapped", async () => {
    const user = userEvent.setup();
    const { onEdit, onDelete } = renderRow();

    await user.click(screen.getByRole("button", { name: /modifica pasta integrale/i }));

    expect(onEdit).toHaveBeenCalledWith(entry);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("still calls onDelete with the entry id when the trash button is tapped", async () => {
    const user = userEvent.setup();
    const { onEdit, onDelete } = renderRow();

    await user.click(screen.getByRole("button", { name: /elimina pasta integrale/i }));

    expect(onDelete).toHaveBeenCalledWith(3);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("disables both buttons while deleting", () => {
    renderRow({ deleting: true });

    expect(screen.getByRole("button", { name: /modifica pasta integrale/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /elimina pasta integrale/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Lanciare il test e verificare che fallisca**

Run (da `web/`): `npm test -- FoodRow`
Expected: FAIL — `onEdit is not a function` / il ruolo `button` con nome "Modifica…" non esiste.

- [ ] **Step 3: Modificare `FoodRow.tsx`**

Sostituire l'intero contenuto di `web/src/components/FoodRow.tsx`:

```tsx
import type { DiaryEntry } from "../api/queries";

interface FoodRowProps {
  entry: DiaryEntry;
  onEdit: (entry: DiaryEntry) => void;
  onDelete: (id: number) => void;
  deleting?: boolean;
}

/** A single logged food within a `MealSection`. `DiaryEntryOut` carries the
 * logged food's `food_name`/`food_brand` (joined server-side from the
 * related `Food` row), so this shows the real name -- the `Alimento #id`
 * fallback only fires for a malformed/incomplete API response.
 *
 * The name/detail area is a button: tapping it opens the edit sheet
 * (`onEdit`). The trash button is a sibling, not nested, so its tap never
 * also triggers `onEdit`.
 *
 * Row separators come from the parent `<ul>`'s `divide-y`, so a row never
 * has to know whether it's the last one. */
function FoodRow({ entry, onEdit, onDelete, deleting = false }: FoodRowProps) {
  const kcal = Math.round((entry.nutriments_snapshot.kcal * entry.grams) / 100);
  const label = entry.food_name || `Alimento #${entry.food_id}`;

  return (
    <li className="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
      <button
        type="button"
        onClick={() => onEdit(entry)}
        disabled={deleting}
        aria-label={`Modifica ${label}`}
        className="min-w-0 flex-1 text-left disabled:opacity-40"
      >
        <span className="block truncate text-[15px] font-medium text-slate-900">{label}</span>
        <span className="block truncate text-[13px] text-slate-500">
          {entry.food_brand ? `${entry.food_brand} · ` : ""}
          {entry.grams} g
        </span>
      </button>

      <span className="shrink-0 tabular-nums text-[15px] font-semibold text-slate-700">
        {kcal}
        <span className="ml-0.5 text-[11px] font-medium text-slate-400">kcal</span>
      </span>

      {/* Icon-only destructive action: a full-width "Elimina" word per row
          made every row look like a button. Accessible name still spells
          out which food it deletes. */}
      <button
        type="button"
        onClick={() => onDelete(entry.id)}
        disabled={deleting}
        aria-label={`Elimina ${label}`}
        className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-400 transition active:bg-red-50 active:text-red-600 disabled:opacity-40"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden
        >
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </button>
    </li>
  );
}

export default FoodRow;
```

(La `<p>` interna è diventata `<span className="block">` perché un `<button>` non può contenere `<p>` per HTML valido.)

- [ ] **Step 4: Lanciare i test e verificare che passino**

Run (da `web/`): `npm test -- FoodRow`
Expected: PASS (3 test).

- [ ] **Step 5: Verificare che il resto della suite compili — fallirà `MealSection`/`DayPage`**

Run (da `web/`): `npm run build`
Expected: FAIL di type-check in `MealSection.tsx` — `FoodRow` ora richiede `onEdit`. È atteso e viene risolto nel Task 4. NON committare finché il build non è verde di nuovo → questo task e il Task 4 vanno committati insieme se si esegue il build tra i due; in alternativa committare ora solo se si esegue `npm test -- FoodRow` (verde) e si prosegue subito col Task 4.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/FoodRow.tsx web/src/components/FoodRow.test.tsx
git commit -m "feat(web): make FoodRow name area tappable to edit the entry"
```

---

## Task 4: Collegare `MealSection` e `DayPage`

**Files:**
- Modify: `web/src/components/MealSection.tsx`
- Modify: `web/src/pages/DayPage.tsx`
- Test: `web/src/pages/DayPage.test.tsx` (modify)

**Interfaces:**
- Consumes:
  - `FoodRow` con prop `onEdit: (entry: DiaryEntry) => void` (Task 3).
  - `EditEntrySheet` con props `{ entry: DiaryEntry; onClose: () => void }` (Task 2).
- Produces: niente per task successivi (ultimo task).

- [ ] **Step 1: Aggiungere `onEdit` a `MealSection`**

In `web/src/components/MealSection.tsx`:

Aggiungere alla `interface MealSectionProps`:

```ts
  onEdit: (entry: DiaryEntry) => void;
```

Aggiornare la firma: `function MealSection({ meal, date, entries, onEdit, onDelete, deletingId }: MealSectionProps) {`

Passare la prop a `FoodRow` nel `.map`:

```tsx
<FoodRow
  key={entry.id}
  entry={entry}
  onEdit={onEdit}
  onDelete={onDelete}
  deleting={deletingId === entry.id}
/>
```

- [ ] **Step 2: Aggiornare il test di `DayPage`**

In `web/src/pages/DayPage.test.tsx` aggiungere, dentro `describe("DayPage", ...)`, questi due test (il file già mocka `usePatchEntry` e definisce `patchMutate`):

```tsx
  it("opens the edit sheet when a food row's name is tapped", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDayPage();

    await user.click(screen.getByRole("button", { name: /modifica yogurt greco/i }));

    expect(screen.getByRole("dialog", { name: /modifica yogurt greco/i })).toBeInTheDocument();
  });

  it("closes the edit sheet when Annulla is clicked", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderDayPage();

    await user.click(screen.getByRole("button", { name: /modifica yogurt greco/i }));
    await user.click(screen.getByRole("button", { name: /annulla/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
```

Note:
- `EditEntrySheet` non è mockato: usa `usePatchEntry` che il file già rimpiazza con `{ mutate: patchMutate, isPending: false }`, quindi il render è innocuo e non tocca la rete.
- `EditEntrySheet` importa `scalePreview` da `QuantityPicker` e `MEAL_LABELS` da `lib/meals`: entrambi reali, nessun mock necessario.

- [ ] **Step 3: Lanciare i nuovi test e verificarne il fallimento**

Run (da `web/`): `npm test -- DayPage`
Expected: FAIL sui due nuovi test — nessun `button` "Modifica…" (DayPage non passa ancora `onEdit`) / nessun `dialog`.

- [ ] **Step 4: Collegare `DayPage.tsx`**

In `web/src/pages/DayPage.tsx`:

Aggiungere agli import:

```tsx
import { useState } from "react";
```

e

```tsx
import EditEntrySheet from "../components/EditEntrySheet";
```

e includere `DiaryEntry` nell'import dei tipi da `../api/queries`:

```tsx
import { MEALS, useDayDiary, useDeleteEntry, type DiaryEntry } from "../api/queries";
```

Dentro il componente, dopo `const deleteEntry = useDeleteEntry();`:

```tsx
  const [editing, setEditing] = useState<DiaryEntry | null>(null);
```

Passare `onEdit` a ogni `MealSection`:

```tsx
<MealSection
  key={meal}
  meal={meal}
  date={date}
  entries={data.entries[meal] ?? []}
  onEdit={setEditing}
  onDelete={handleDelete}
  deletingId={deletingId}
/>
```

Renderizzare lo sheet — aggiungere subito prima della chiusura `</div>` del wrapper `<div className="mx-auto max-w-2xl space-y-4 p-4">`, oppure come ultimo figlio del `<div>` radice:

```tsx
{editing && <EditEntrySheet entry={editing} onClose={() => setEditing(null)} />}
```

- [ ] **Step 5: Lanciare l'intera suite web**

Run (da `web/`): `npm test`
Expected: PASS — tutti i file, inclusi `DayPage`, `FoodRow`, `EditEntrySheet`, `MealSection` (via DayPage), `QuantityPicker`.

- [ ] **Step 6: Type-check + lint + build**

Run (da `web/`): `npm run build && npx eslint src`
Expected: build OK, nessun errore di lint.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/MealSection.tsx web/src/pages/DayPage.tsx web/src/pages/DayPage.test.tsx
git commit -m "feat(web): wire the edit-entry sheet into the Day page"
```

---

## Self-Review

**Spec coverage:**
- "Tap sull'area nome apre un bottom sheet" → Task 3 (FoodRow button) + Task 4 (DayPage monta lo sheet). ✓
- "Bottone cestino separato e invariato" → Task 3, il `<button>` cestino resta fratello, stessa resa. ✓
- "EditEntrySheet nuovo, QuantityPicker invariato" → Task 2 crea il componente, riusa solo `scalePreview` (già export). ✓
- "Input grammi default = entry.grams, preset 100 g, niente preset porzione" → Task 2 Step 3. ✓
- "Preview macro da nutriments_snapshot" → Task 2, `scalePreview(entry.nutriments_snapshot, …)`. ✓
- "Selettore pasto 4 pillole, preselezionata quella corrente" → Task 2, `MEALS.map` + `aria-pressed`. ✓
- "Salva → patchEntry.mutate({ id, grams, meal }), onSuccess chiude" → Task 2 `handleSave`. ✓
- "isPending disabilita Salva; isError riga rossa; grammi ≤ 0 invalido" → Task 2 Step 3 + test. ✓
- "onSettled invalida ['diary','day']" → già in `usePatchEntry`, non modificato. ✓
- "Nessun optimistic update" → nessun `onMutate`, coerente con delete. ✓
- Label pasti condivise → Task 1 estrae `MEAL_LABELS` in `lib/meals.ts`. ✓
- Test elencati nello spec → EditEntrySheet.test (Task 2), FoodRow.test (Task 3), DayPage.test (Task 4). ✓
- Fuori scope (spostamento di giorno, riordino, optimistic, refactor sheet condiviso) → non toccati. ✓

**Placeholder scan:** nessun TBD/TODO; ogni step di codice ha il codice completo. ✓

**Type consistency:**
- `EditEntrySheetProps` = `{ entry: DiaryEntry; onClose: () => void }` — identico in Task 2 (def), Task 4 (uso). ✓
- `FoodRowProps.onEdit: (entry: DiaryEntry) => void` — identico in Task 3 (def), Task 4 (MealSection passa `onEdit`, DayPage passa `setEditing` che è `(entry: DiaryEntry) => void`). ✓
- `MealSectionProps.onEdit` stessa firma. ✓
- `usePatchEntry().mutate({ id, grams, meal })` → `PatchEntryInput = { id: number; grams?: number; meal?: Meal }` in `queries.ts`. ✓
- `client.patch` chiamato come `/diary/entries/${id}` con body `{ grams, meal }` — coerente con `usePatchEntry` esistente (`client.patch(\`/diary/entries/${id}\`, body)` dove `body` è `{grams, meal}`). Il test asserisce esattamente questo. ✓

Nessuna incoerenza rilevata.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-31-edit-diary-entry.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
