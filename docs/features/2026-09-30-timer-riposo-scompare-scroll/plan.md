# Piano: la barra del timer di riposo sparisce scorrendo in basso

- Data: 2026-09-30
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: bug
- Branch: fix/timer-riposo-scompare-scroll

## Approccio

La correzione segue la spec approvata: un hook `useVisualViewportTop()` in `web/src/lib/useVisualViewportTop.ts`, sul modello di `web/src/lib/useNow.ts` (stato + `useEffect` con cleanup), e l'uso dell'hook sull'`<header className="app-header">` della sessione live in `web/src/pages/gym/WorkoutPage.tsx:185`. Prima si scrive il test di regressione in `web/src/pages/gym/WorkoutPage.test.tsx`, che esiste già (4 test, mock di `../../api/gym`, `renderPage()` con `MemoryRouter`) e fa da test di caratterizzazione della pagina. Anche `web/src/components/gym/RestTimerBar.test.tsx` esiste già e non va toccato: `RestTimerBar.tsx` non cambia. jsdom (29.1.1) non implementa `window.visualViewport`, quindi il test lo sostituisce con un `EventTarget` finto che ha `offsetTop` e `height`, lo installa con `Object.defineProperty(window, "visualViewport", { configurable: true, value })` e lo rimuove in `afterEach`.

Il primo task crea il branch `fix/timer-riposo-scompare-scroll` a partire da `main`. Il codice coinvolto (`WorkoutPage.tsx`, `RestTimerBar.tsx`, la regola `.app-header` in `web/src/index.css:118-121`) è identico su `main` e su `feature/stats`.

Nota sul caso senza API: la spec chiede che l'hook restituisca 0 quando `window.visualViewport` non esiste, e che in quel caso l'header non riceva nessun `top`. Per rispettare entrambe le cose, l'header riceve `style={{ top: offsetTop }}` solo quando `offsetTop` è diverso da 0 (`style={offsetTop ? { top: offsetTop } : undefined}`). Con 0 vale il `top-0` di `.app-header`, che dà lo stesso risultato, e il DOM resta identico a oggi.

Gli "Altri punti colpiti" della spec (header sticky delle altre pagine, elementi `fixed` in basso) sono in "Fuori scope" nella spec approvata. Per questo non ci sono task per loro. Il piano non prevede refactoring né modifiche a `.app-header`.

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Branch e test di regressione sull'header della sessione live

- Copre: C2
- File: `web/src/pages/gym/WorkoutPage.test.tsx` (modifica)
- Passi:
  1. Branch già creato dall'orchestratore: `fix/timer-riposo-scompare-scroll` da `main` (7c06bdf). Verificare con `git branch --show-current`.
  2. In `WorkoutPage.test.tsx` aggiungere un `describe("WorkoutPage header and visual viewport", ...)` che riusa il `beforeEach` dei mock esistenti. Per avere la barra visibile, `useActiveWorkout` restituisce una copia di `workout` con `rest_ends_at` 90 secondi nel futuro, `rest_total_s: 90` e `server_now` uguale ad adesso.
  3. Aggiungere un helper che crea il visual viewport finto: un `EventTarget` con le proprietà `offsetTop` e `height` modificabili. `addEventListener` e `removeEventListener` vengono da `EventTarget`. L'helper lo installa con `Object.defineProperty(window, "visualViewport", { configurable: true, value })`. In `afterEach` la proprietà viene rimossa con `delete`, perché jsdom non la definisce.
  4. Caso 1, "keeps the header in the visible area when the visual viewport moves": installare il viewport finto con `offsetTop = 0`, `renderPage()`, poi impostare `offsetTop = 300` e fare `dispatchEvent(new Event("scroll"))` dentro `act()`. Trovare l'header con `screen.getByRole("timer").closest("header")` e verificare che `style.top` sia `"300px"`.
  5. Caso 2, "works without the visualViewport API": senza viewport finto, `renderPage()`, verificare che `getByRole("timer")` esista e che l'header che lo contiene abbia `style.top === ""`.
- Verifica: `cd web && npx vitest run src/pages/gym/WorkoutPage.test.tsx`. Risultato atteso: il caso 1 **fallisce** con l'errore del bug, cioè `expected '' to be '300px'` (`style.top` vuoto). Il caso 2 passa già senza correzione ed è atteso così. I 4 test esistenti restano verdi. È l'unico task che lascia un test rosso.

### [x] T2. Hook `useVisualViewportTop()` e aggancio dell'header al visual viewport

- Copre: C2, C3
- File: `web/src/lib/useVisualViewportTop.ts` (nuovo), `web/src/lib/useVisualViewportTop.test.ts` (nuovo), `web/src/pages/gym/WorkoutPage.tsx` (modifica)
- Passi:
  1. Creare `useVisualViewportTop.ts`, sul modello di `useNow.ts`: `useState(() => window.visualViewport?.offsetTop ?? 0)`. In un `useEffect` senza dipendenze, se `window.visualViewport` esiste, registrare lo stesso handler (`setTop(vv.offsetTop)`) su `scroll` e `resize` e rimuoverlo nel cleanup. Se l'API non esiste, non fare niente e restituire 0. Aggiungere un commento breve che rimanda al bug WebKit di iOS 26 (visual viewport spostato dopo la chiusura della tastiera, WebKit 297779 / FB19889436) e alla spec.
  2. In `WorkoutPage.tsx`, dentro `WorkoutSession`, chiamare `const viewportTop = useVisualViewportTop();` insieme agli altri hook, prima di qualsiasi `return` anticipato, per rispettare le regole degli hook. Poi passare all'header della riga 185 `style={viewportTop ? { top: viewportTop } : undefined}`. `.app-header` in `index.css` non cambia, e `RestTimerBar.tsx` nemmeno.
  3. Creare `useVisualViewportTop.test.ts` con `renderHook` (già usato in `web/src/api/queries.test.tsx`). Casi: restituisce 0 senza `window.visualViewport`; legge l'`offsetTop` iniziale; si aggiorna su `resize`, perché lo `scroll` è coperto da T1; dopo `unmount` rimuove i listener di `scroll` e `resize`, verificato con `vi.spyOn(vv, "removeEventListener")`. Lo stesso helper per il viewport finto di T1 va replicato qui in piccolo, senza creare moduli di test condivisi.
- Verifica: `cd web && npx vitest run src/pages/gym/WorkoutPage.test.tsx src/lib/useVisualViewportTop.test.ts`, risultato atteso: tutti verdi, compreso il caso 1 di T1. Poi `cd web && npm test`, risultato atteso: tutta la suite verde. Infine `cd web && npx tsc -b`: nessun errore di tipo.

### [x] T3. Verifica manuale su iPhone dopo il deploy (non bloccante)

- Copre: C1
- File: Nessuno
- Passi:
  1. Dopo il merge e il deploy, su un iPhone con iOS 26.0.x aprire la sezione palestra in Safari e avviare un allenamento con diversi esercizi (5 o più).
  2. Completare una serie per far partire il timer di riposo. Scrivere e confermare un valore in un campo kg o Rip., chiudere la tastiera e scorrere fino vicino al fondo della pagina.
  3. Ripetere senza aver mai toccato un campo, subito dopo l'apertura dell'allenamento.
  4. Ripetere i passi 1-3 nella PWA installata.
- Verifica: manuale. Risultato atteso: in tutti i casi la barra del timer di riposo, insieme a cronometro e "Termina", resta visibile in cima allo schermo anche vicino al fondo. Il passo non blocca i test automatici né il merge. Se il bug resta, come dice la spec la diagnosi va ripresa: annotare nel registro i valori di `visualViewport.offsetTop`, `visualViewport.height` e `innerHeight` vicino al fondo, se si riesce a leggerli (per esempio con Web Inspector da Mac).

## Registro di esecuzione

Commit di partenza: 7c06bdf (main)

T1 — DONE — review: 1 round — commit: 68d7959 (insieme a T2)
T2 — DONE — review: 1 round — commit: 68d7959
  - MINOR (non corretto): `web/src/lib/useVisualViewportTop.ts:7-18` l'effect non ha array di dipendenze, quindi riregistra i listener a ogni render (ogni secondo per `useNow`). Con `[]` basterebbe una registrazione.
  - MINOR (non corretto): l'effect non risincronizza `offsetTop` dopo aver registrato i listener; finestra di pochi ms tra `useState` e `useEffect`.
T3 — DONE — verifica manuale su iPhone ok (utente, 2026-09-30) — commit: no
