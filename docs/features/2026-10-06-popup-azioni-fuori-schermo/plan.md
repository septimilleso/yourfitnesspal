# Piano: popup menu "•••" fuori dallo schermo in PWA

- Data: 2026-10-06
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: bug
- Branch: fix/popup-azioni-fuori-schermo

testCommand: `cd web && npm test` (vitest run, ambiente jsdom, setup in `web/src/test/setup.ts`).

## Approccio

Bug: prima un test di regressione che fallisce (T1), poi la correzione minima solo in `web/src/components/gym/ActionMenu.tsx` (T2). Il menu resta `absolute` dentro il wrapper `relative`; all'apertura, in `useLayoutEffect` sullo stato `open`, si misurano wrapper e `<ul>` con `getBoundingClientRect()` e si scelgono lato verticale e allineamento orizzontale. Nessuna modifica alle props pubbliche (`label`, `actions`, `trigger`, `triggerClassName`) né ai chiamanti. Gli "Altri punti colpiti" della spec (`GymStartPage`, `SetRow`, `WorkoutExerciseCard`, `TemplateEditorPage`, header di `WorkoutDetailPage` e `SavedWeekDetailPage`) sono corretti dalla stessa modifica; si aggiunge solo un test su `SetRow` per il caso allineamento a sinistra (T3).

Contratto testabile (deciso qui, usato da T1 e T2): il `<ul role="menu">` espone `data-placement="top" | "bottom"` e `data-align="left" | "right"`. Valori iniziali, prima della misura: `bottom` e `right` (comportamento attuale). Classi corrispondenti: `bottom` = `mt-1`, `top` = `bottom-full mb-1`, `right` = `right-0`, `left` = `left-0`.

Decisione aperta della spec, risolta: limite inferiore del flip. Si legge `document.querySelector('nav[aria-label="Navigazione principale"]')` (presente in `web/src/components/AppShell.tsx:72-73`, `fixed bottom-0`, altezza già comprensiva della safe area) e si usa il suo `getBoundingClientRect().top` come limite. Fallback a `window.innerHeight` se la nav non esiste o se il suo `top` non è un valore valido (`<= 0` o `> window.innerHeight`, il caso degli zeri di jsdom). Motivo: `--nav-height` non è leggibile in JS e una costante fissa andrebbe tenuta allineata a mano con `index.css:18-19` e con la safe area, che varia per dispositivo; la nav reale è la misura esatta. Margine di sicurezza costante di 8 px sopra il limite.

Regole di scelta (da implementare in T2):
- Verticale: `spaceBelow = limite - trigger.bottom - 8`, `spaceAbove = trigger.top - 8`. Si apre verso l'alto (`top`) se `spaceBelow < menu.height` e `spaceAbove > spaceBelow`; altrimenti `bottom`.
- Orizzontale: `right` se `trigger.right - menu.width >= 8`; altrimenti `left`. In jsdom senza mock (rettangoli a zero) il risultato è `bottom`/`left`: innocuo, i `menuitem` restano nel DOM e cliccabili, quindi i test esistenti non cambiano.

Il "trigger" misurato è il wrapper `relative` (ref sul `<div>`), perché `right-0`/`left-0` e `bottom-full` sono relativi a lui.

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Test di regressione per il posizionamento del menu (deve fallire)

- Copre: C2 (e prepara la verifica di C1)
- File: `web/src/components/gym/ActionMenu.test.tsx` (nuovo)
- Passi:
  1. Creare il file con vitest + Testing Library (stesso stile di `web/src/components/gym/SetRow.test.tsx`: `render`, `screen`, `fireEvent`, `afterEach`). Nessun fake timer necessario.
  2. In `beforeEach` impostare viewport 390x700 con `Object.defineProperty(window, "innerWidth", { value: 390, configurable: true })` e idem `innerHeight` = 700. In `afterEach`: `vi.restoreAllMocks()`, rimuovere l'eventuale `<nav>` aggiunto al body, ripristinare i valori originali di `innerWidth`/`innerHeight`.
  3. Helper `mockLayout({ trigger, menu = { width: 224, height: 190 } })`: `vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")` con implementazione basata su `this`. Se `this.getAttribute("role") === "menu"` restituisce il rettangolo del menu; se `this` è il bottone con `aria-label` del trigger o il suo `parentElement` (wrapper) restituisce il rettangolo del trigger; altrimenti rettangolo a zero. Un helper `rect(top, left, width, height)` costruisce l'oggetto completo (`top`, `bottom`, `left`, `right`, `width`, `height`, `x`, `y`, `toJSON`). Così il test non dipende da quale dei due elementi legge la correzione.
  4. Caso 1, percorso utente: renderizzare `TemplateCard` (`web/src/components/gym/TemplateCard.tsx`) con `template = { id: 1, name: "Push", folder_id: null, last_used_at: null, exercise_names: ["Panca"] }` e handler `vi.fn()`. Trigger "Azioni Push" in basso a destra: top 580, bottom 610 (circa 90 px dal fondo), left 340, right 380. Cliccare il bottone, poi `screen.getByRole("menu")`: atteso `data-placement="top"`, `data-align="right"`, classe `bottom-full` presente e `mt-1` assente.
  5. Caso 2, `ActionMenu` diretto con `label="Azioni test"` e due azioni: trigger in alto con spazio (top 100, bottom 130, left 340, right 380): atteso `data-placement="bottom"`, `data-align="right"`, classe `mt-1`, `right-0`.
  6. Caso 3, trigger vicino al bordo sinistro (card di sinistra, top 100, bottom 130, left 8, right 170): atteso `data-align="left"`, classe `left-0`, `right-0` assente, `data-placement="bottom"`.
  7. Caso 4, limite dato dalla nav: aggiungere a `document.body` un `<nav aria-label="Navigazione principale">` il cui `getBoundingClientRect` (distinguerlo con `this.tagName === "NAV"`) restituisce `top: 600`. Trigger top 450, bottom 480, left 340, right 380. Senza nav lo spazio sotto (`700 - 480 - 8 = 212`) basterebbe per 190 px; con la nav (`600 - 480 - 8 = 112`) no e sopra c'è più spazio: atteso `data-placement="top"`.
  8. Caso 5, non regressione del default: nessun mock del layout (rettangoli a zero), il menu si apre e `screen.getByRole("menuitem", { name: ... })` è presente e cliccabile (richiama `onSelect` e chiude il menu).
- Verifica: `cd web && npx vitest run src/components/gym/ActionMenu.test.tsx`, risultato atteso: FALLISCONO i casi 1, 3 e 4 (e il 2 per l'attributo mancante) con errori del tipo `expected element to have attribute data-placement="top"` / `data-align="left"`, perché `ActionMenu.tsx` oggi apre sempre sotto e con `right-0`; il caso 5 passa. Il fallimento è quello del bug (menu sempre sotto e a destra), non un errore di import o di sintassi. T1 è l'unico task che lascia test rossi (previsto per un bug): registrare l'output rosso nel registro prima di passare a T2.

### [x] T2. Correggere il posizionamento in ActionMenu

- Copre: C1, C3
- File: `web/src/components/gym/ActionMenu.tsx` (modifica)
- Passi:
  1. Importare `useLayoutEffect`, `useRef` da `react`. Aggiungere `ref` al wrapper `<div className="relative">` (`ActionMenu.tsx:22`) e al `<ul role="menu">` (`ActionMenu.tsx:39`).
  2. Aggiungere stato `placement: { vertical: "bottom" | "top"; align: "right" | "left" }`, iniziale `{ vertical: "bottom", align: "right" }`. Reimpostarlo al valore iniziale alla chiusura (o a ogni apertura prima della misura) così ogni apertura parte dal default.
  3. In `useLayoutEffect` con dipendenza `[open]`: se `open` e i ref esistono, leggere `wrapper.getBoundingClientRect()`, `menu.getBoundingClientRect()`, `window.innerHeight` e `document.querySelector('nav[aria-label="Navigazione principale"]')`. Limite inferiore = `nav.getBoundingClientRect().top` se `> 0` e `<= window.innerHeight`, altrimenti `window.innerHeight`. Applicare le regole di scelta elencate in Approccio (margine 8 px) e fare `setPlacement` solo se il valore cambia, per evitare render inutili.
  4. Applicare le classi dalla tabella dell'Approccio (`mt-1` / `bottom-full mb-1`, `right-0` / `left-0`) e aggiungere `data-placement` e `data-align` al `<ul>`. Mantenere le restanti classi (`absolute z-50 w-56 overflow-hidden rounded-xl border ... shadow-card`) e il backdrop `fixed inset-0 z-40` invariati.
  5. Non toccare le props, `Action`, né i file chiamanti. Nessun refactoring, nessun portal, nessun listener su scroll o resize (fuori scope).
- Verifica:
  1. `cd web && npx vitest run src/components/gym/ActionMenu.test.tsx`, risultato atteso: tutti i casi di T1 passano.
  2. `cd web && npm test`, risultato atteso: l'intera suite è verde, in particolare `SetRow.test.tsx`, `WorkoutDetailPage.test.tsx`, `SavedWeekDetailPage.test.tsx`, `WeekPage.test.tsx` (aprono il menu con rettangoli a zero).
  3. `cd web && npx tsc -b`, risultato atteso: nessun errore di tipo.

### [x] T3. Test su SetRow: menu allineato a sinistra

- Copre: C1 (parte sinistra, percorso `SetRow`), C3
- File: `web/src/components/gym/SetRow.test.tsx` (modifica, un solo `it` nuovo)
- Passi:
  1. Aggiungere un test "opens the set menu aligned to the left of the narrow number cell". Nel test mockare `HTMLElement.prototype.getBoundingClientRect` con `vi.spyOn` (restituire il rettangolo del menu, 224x190, per `role="menu"`; per il bottone `Serie 1` e il suo wrapper un rettangolo left 32, right 68, top 100, bottom 136; zeri per gli altri) e impostare `window.innerWidth/innerHeight` a 390x700; ripristinare tutto in un `try/finally` o in `afterEach` del blocco (`vi.restoreAllMocks()`), senza interferire con i fake timer del `beforeEach` esistente.
  2. Cliccare `screen.getByRole("button", { name: "Serie 1" })` e verificare che `screen.getByRole("menu")` abbia `data-align="left"` e `data-placement="bottom"`; il menuitem "Elimina serie" resta presente.
  3. Non modificare gli altri test del file.
- Verifica: `cd web && npx vitest run src/components/gym/SetRow.test.tsx`, risultato atteso: tutti i test del file passano, compreso il nuovo (che fallirebbe sul codice precedente alla correzione per l'attributo assente).

### [x] T4. Verifica finale automatica

- Copre: C1, C2, C3
- File: nessuno (sola verifica)
- Passi:
  1. Eseguire la suite completa e il build di tipi.
  2. Controllare con `git diff --stat main` che i file toccati siano solo `ActionMenu.tsx`, `ActionMenu.test.tsx`, `SetRow.test.tsx` e i documenti della feature.
- Verifica: `cd web && npm test && npx tsc -b`, risultato atteso: tutti i test passano, nessun errore di tipo; il diff non contiene file chiamanti di `ActionMenu`.

### [ ] T5. Verifica manuale su iPhone (PWA)

- Copre: C1 (conferma su dispositivo; il taglio è dedotto dal codice, non osservato)
- File: nessuno
- Passi: dopo il deploy del branch (git pull sul server remoto e rebuild del web, come da prassi), aprire la PWA aggiornata su iPhone e verificare:
  1. Sezione palestra, lista modelli: toccare "•••" su una card in basso nella colonna destra. Il menu si apre verso l'alto, con le 4 voci (Modifica, Duplica, Sposta in cartella, Elimina) tutte visibili e sopra la tab bar.
  2. Stessa prova su una card della colonna sinistra: il menu è allineato a sinistra del trigger, il testo delle voci è tutto visibile.
  3. Card in alto: il menu si apre sotto, allineato a destra come prima.
  4. Allenamento attivo: toccare il numero di una serie (ultima serie in fondo e prima serie in alto): "Elimina serie" è leggibile e dentro lo schermo; verificare anche con la barra "allenamento attivo" visibile sopra la tab bar.
  5. Menu cartella in `GymStartPage` (cartella vicina al fondo) e menu di `WorkoutExerciseCard`/editor modello: nessuna voce tagliata.
  6. Header di dettaglio allenamento e di settimana salvata: il menu resta sotto, allineato a destra (nessuna regressione).
  7. Confermare che la scelta della nav come limite funziona con la home indicator (nessuna voce coperta dalla tab bar).
- Verifica: esito della prova manuale annotato nel registro; se il menu risulta ancora tagliato, aprire un follow-up con le misure reali invece di modificare il piano.

## Registro di esecuzione

Commit di partenza: fb6d7d99bbccbb304974b8ebe5416dcbe125a1e4

## Domande aperte

Nessuna. La decisione sul limite inferiore del flip è risolta in Approccio (nav letta via `document.querySelector`, fallback a `window.innerHeight`). Restano fuori scope i punti elencati nella spec (portal/fixed, backdrop dei menu in header, viewport molto stretti, riposizionamento dopo l'apertura).

T1 — DONE — review: 1 round (1 MINOR: caso 1 non verifica viewport, accettato) — commit: no (test rosso, va con T2). Output rosso: 4 fallimenti (data-placement/data-align null), caso 5 verde.
T2 — DONE — review: 1 round (1 MINOR non bloccante) — commit: 35e6387 (include test T1)
T3 — DONE — review: 2 round (BLOCKER tsc this-annotation corretto, verificato tsc+vitest) — commit: a53041a
T4 — DONE — npm test 61 file/391 test verdi, tsc -b pulito, diff solo ActionMenu.tsx + 2 test — commit: no
T5 — in attesa: verifica manuale iPhone PWA dopo deploy (a carico utente)
