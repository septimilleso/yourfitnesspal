# Modifica e spostamento di una entry del diario

## Problema

Dopo aver registrato un alimento nel diario del giorno, l'unico modo per correggere
un errore (grammi sbagliati, pasto sbagliato) è eliminarlo e reinserirlo da capo,
ripassando per la ricerca. Serve poter modificare la quantità e spostare l'alimento
tra Colazione / Pranzo / Cena / Spuntino direttamente dalla Day page.

## Scope

Feature **solo frontend**. Il backend supporta già tutto:

- `PATCH /api/diary/entries/{id}` accetta `grams` e/o `meal`.
- L'hook `usePatchEntry` (`web/src/api/queries.ts`, `PatchEntryInput = { id, grams?, meal? }`)
  esiste già e invalida `["diary","day"]` su `onSettled`.

Nessuna modifica ad API, modelli, migrazioni o hook.

### Fuori scope

- Spostare una entry a un **altro giorno** (il PATCH backend non accetta `date`).
- Riordino delle entry all'interno dello stesso pasto (`position`).
- Optimistic update (coerente con l'attuale flusso di delete, che non ne ha).
- Refactor/estrazione di un componente sheet condiviso con `QuantityPicker`.

## Interazione

- Tap sull'area nome/dettaglio di una riga alimento (`FoodRow`) apre un bottom
  sheet di modifica.
- Il bottone cestino resta separato a destra e invariato.
- Lo sheet permette in un'unica schermata di cambiare i grammi **e** il pasto;
  un solo tap su "Salva" applica entrambi.

## Componenti

### `web/src/components/EditEntrySheet.tsx` (nuovo)

Bottom sheet con la stessa struttura visiva di `QuantityPicker`:
overlay `fixed inset-0 z-50`, `items-end` su mobile / `items-center` da `sm:`,
grabber, footer con padding `var(--safe-bottom)`.

Props:

```ts
interface EditEntrySheetProps {
  entry: DiaryEntry;
  onClose: () => void;
}
```

Contenuto:

- Header: `entry.food_name` + `entry.food_brand` se presente.
- Campo **Grammi**: `<input type="number" inputMode="numeric" min={0}>`,
  stato iniziale `entry.grams`. Preset rapido "100 g".
  Nessun preset "Porzione": lo snapshot non porta `serving_size_g`.
- **Selettore pasto**: 4 pillole (Colazione/Pranzo/Cena/Spuntino) con la
  stessa resa visiva delle pillole porzione di `QuantityPicker`. Stato iniziale
  `entry.meal`. Riusa `MEALS` e le label da `MealSection` (estrarre
  `MEAL_LABELS` in un punto importabile, es. `web/src/lib/meals.ts`, oppure
  duplicare le 4 stringhe — decisione di implementazione).
- **Preview macro** live (kcal / prot. / carb. / grassi) calcolata da
  `entry.nutriments_snapshot` scalata per `grams / 100`. Riusa `scalePreview`
  già esportata da `QuantityPicker.tsx` (import diretto; è già `export`).
- Footer: `Annulla` (chiude senza salvare) / `Salva`.

Comportamento:

- Grammi non validi (`!(grams > 0)`): messaggio d'errore inline, "Salva"
  disabilitato.
- "Salva" → `patchEntry.mutate({ id: entry.id, grams, meal })`.
  Manda entrambi i campi (il backend accetta valori uguali a quelli attuali).
- `patchEntry.isPending`: "Salva" disabilitato.
- `patchEntry.isError`: riga rossa "Errore durante il salvataggio delle modifiche.".
- `onSuccess`: `onClose()`.

Usa `usePatchEntry()` da `web/src/api/queries.ts`.

### `web/src/components/FoodRow.tsx` (modifica)

- Nuova prop `onEdit: (entry: DiaryEntry) => void`.
- L'area nome/dettaglio (`<div className="min-w-0 flex-1">`) diventa un
  `<button type="button">` a piena larghezza, `onClick={() => onEdit(entry)}`,
  `aria-label={`Modifica ${label}`}`, allineamento testo a sinistra.
- Il bottone cestino e la resa dei kcal restano invariati.

### `web/src/components/MealSection.tsx` (modifica)

- Nuova prop `onEdit: (entry: DiaryEntry) => void`, passata a ogni `FoodRow`.

### `web/src/pages/DayPage.tsx` (modifica)

- Stato locale `const [editing, setEditing] = useState<DiaryEntry | null>(null)`.
- `onEdit={setEditing}` passato a ogni `MealSection`.
- Quando `editing` non è null, renderizza
  `<EditEntrySheet entry={editing} onClose={() => setEditing(null)} />`.

## Flusso dati

1. Tap riga → `DayPage` imposta `editing` con la `DiaryEntry`.
2. Sheet montato con quella entry come stato iniziale.
3. "Salva" → `usePatchEntry` → `PATCH /api/diary/entries/{id}` con `{ grams, meal }`.
4. `onSettled` invalida `["diary","day"]`.
5. `onSuccess` chiude lo sheet; la Day page si riprende i dati: l'alimento
   sparisce dal vecchio pasto e compare nel nuovo con i nuovi grammi, i totali
   e la ring si aggiornano.

Nessun optimistic update: breve stato di caricamento come per il delete.

## Test (vitest)

### `web/src/components/EditEntrySheet.test.tsx` (nuovo)

- Grammi iniziali = `entry.grams`; pillola pasto iniziale = `entry.meal`.
- Cambiando i grammi la preview macro si riscala.
- Selezionando un'altra pillola pasto cambia la selezione.
- "Salva" chiama il PATCH con `{ id, grams, meal }` corretti (mock del client).
- Grammi `0` → "Salva" disabilitato + messaggio d'errore.
- Errore del PATCH → messaggio d'errore mostrato, sheet non chiuso.
- Successo → `onClose` chiamato.

### `web/src/components/FoodRow.test.tsx` (modifica)

- Tap sull'area nome chiama `onEdit` con la entry.
- Il cestino chiama ancora `onDelete` e non `onEdit`.

### `web/src/pages/DayPage.test.tsx` (modifica)

- Tap su una riga alimento monta `EditEntrySheet`.
- `onClose` lo smonta.

## Rischi / note

- `FoodRow` con due target tap annidati (area modifica + cestino): il cestino
  è un `<button>` fratello, non annidato nell'area modifica, quindi nessun
  problema di click che si propaga.
- Se in futuro serve lo spostamento di giorno, va esteso prima il backend PATCH.
