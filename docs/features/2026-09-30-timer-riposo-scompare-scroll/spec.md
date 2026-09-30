# Bug: la barra del timer di riposo sparisce scorrendo in basso

- Data: 2026-09-30
- Tipo: bug
- Stato: approvata

## Sintomo

Durante un allenamento in palestra, la barra del timer di riposo sparisce quando si arriva vicino al fondo della pagina. A metà pagina resta visibile. Non succede durante il rimbalzo elastico oltre il fondo, e non serve che la tastiera sia aperta o che la pagina sia ingrandita.

## Passi per riprodurre

1. Su iPhone, in Safari oppure nella PWA installata, aprire la sezione palestra e avviare un allenamento con diversi esercizi.
2. Completare una serie per far partire il timer di riposo.
3. Con tastiera chiusa e senza zoom, scorrere la pagina dell'allenamento fino vicino al fondo.

## Atteso e osservato

- Atteso: la barra del timer di riposo resta sempre visibile, fissa in cima allo schermo, a qualsiasi livello di scroll.
- Osservato: la barra resta visibile a metà pagina ed esce dallo schermo quando si arriva vicino al fondo.

## Ambiente

iPhone con iOS 26.0.x, sia in Safari sia nella PWA installata. Senza tastiera aperta e senza pinch-zoom. Quando la barra sparisce, esce dallo schermo tutto l'header (anche cronometro e "Termina"). Non è noto se succede anche senza aver mai toccato un campo kg/Rip. Frequenza e data di comparsa non indicate. Il codice della barra e dell'header non è cambiato dall'introduzione della sessione live (commit `dacc67d`, `f162550`).

## Causa radice

Stato: **probabile, non confermata sul dispositivo**. Le risposte dell'utente (iOS 26.0.x, sparisce tutto l'header) confermano l'ipotesi 1. Il codice dell'app non contiene nessun meccanismo che faccia uscire la barra vicino al fondo, e il bug non si riproduce nei browser emulati. La causa più probabile è un comportamento di WebKit su iOS (vedi le ipotesi in "Domande aperte"), da confermare sul dispositivo.

Come è montata la barra:

- `RestTimerBar` sta dentro l'header della sessione live (`web/src/pages/gym/WorkoutPage.tsx:185-212`, barra alle righe 207-211). La barra non ha un posizionamento proprio (`web/src/components/gym/RestTimerBar.tsx:42`) ed è l'ultimo figlio dell'header. Resta in vista solo perché l'header è sticky, quindi **header e barra si muovono sempre insieme**: se la barra esce dallo schermo per uno scroll, esce anche la riga con cronometro e "Termina".
- La barra si nasconde da sola in un solo caso: quando il riposo è finito (`RestTimerBar.tsx:38`, `remaining <= 0`). La condizione dipende solo dall'orologio e da `rest_ends_at`, non dalla posizione di scroll.
- L'header usa `.app-header`, cioè `sticky top-0 z-20`, con `backdrop-blur-xl` e `padding-top: var(--safe-top)` (`web/src/index.css:118-121`).

Cause che dipendono dal codice, verificate ed escluse:

- **Contenitore sticky che finisce prima del fondo.** Il genitore dell'header è il `div` radice di `WorkoutSession` (`WorkoutPage.tsx:184`). È l'unico figlio di `#root`, e `#root` è l'unico figlio di `body` oltre allo script. Misurato in WebKit: il `div` va da 0 alla fine del documento (`rootBottom = scrollHeight = 3815px`). Picker, sheet e dettaglio esercizio sono renderizzati dentro il `div` e sono `fixed` (`web/src/components/gym/Sheet.tsx:21`). L'unico elemento fuori dal `div` è il toast, anch'esso `fixed` (`WorkoutPage.tsx:46-53`). Il padding in fondo (`pb-[calc(2rem+var(--safe-bottom))]`, circa 66px su iPhone) toglie spazio al contenitore sticky solo per quella fascia. L'header è alto 165px con le safe area di un iPhone e la vista è alta almeno 480px, quindi l'header resta comunque agganciato.
- **Antenati con `overflow`, `transform`, `filter` o altezza limitata, oppure un secondo contenitore di scroll.** Non ce ne sono: `main.tsx`, `AuthGuard` e `PermissionGuard` non aggiungono wrapper con stile. `html` e `body` non hanno `overflow`, `height`, `overflow-x-hidden` o regole sotto media query (`web/src/index.css:22-57`). L'unico `transform` in `index.css` (riga 132) riguarda `.settings-scene`, che non esiste in questa pagina. La pagina è fuori da `AppShell` (`web/src/App.tsx:58-60`). L'elemento che scorre è la finestra.
- **`100vh`, modalità standalone, `dvh`.** Il `div` usa `min-h-screen` (100vh), che fissa solo un'altezza minima e non tocca il contenitore sticky quando la pagina è lunga. Nel codice non ci sono regole `display-mode: standalone`, unità `dvh`/`svh`/`lvh`, `IntersectionObserver` o listener di scroll. `index.html` usa `viewport-fit=cover` e `apple-mobile-web-app-status-bar-style=default`: la seconda non sposta il layout.
- **Zoom automatico al focus.** Escluso: i campi numerici sono a 16px (`web/src/components/gym/NumberInput.tsx:67`, `web/src/index.css:39-43`).

Riproduzione con la pagina reale (server Vite temporaneo, API simulate, timer attivo), script Playwright fuori dal progetto:

- WebKit con emulazione iPhone 13, safe area forzate a 47/34px, vista alta 480, 664 e 844px, con 2 e con 8 esercizi, scroll fino al massimo: la barra resta sempre a `top = 107px`, l'header a 0 e `visualViewport.offsetTop = 0`. Stesso risultato in Chromium con emulazione Pixel 7. **Il bug non si riproduce.**
- La barra esce dallo schermo solo se il visual viewport è più piccolo del layout viewport e viene spostato verso il basso: simulato in Chromium con scala 1,6, la barra finisce a -254px rispetto alla parte visibile. È lo stesso comportamento che produrrebbe su iPhone un visual viewport rimasto ridotto o spostato (ipotesi 1 in "Domande aperte").

Catena da causa a sintomo per l'ipotesi più probabile (da confermare):

1. Durante l'allenamento l'utente digita nei campi kg/Rip. (`NumberInput.tsx:43-67`) e poi chiude la tastiera.
2. Su alcune versioni di iOS 26, in Safari e nelle web app installate, dopo la chiusura della tastiera il visual viewport non torna come prima. `visualViewport.height` resta più piccolo di `innerHeight` e/o `offsetTop` resta maggiore di 0. È un bug WebKit segnalato: WebKit 297779, Apple Feedback FB19889436, discussione su Apple Developer Forums thread 800125.
3. `position: sticky; top: 0`, come `fixed`, si aggancia al bordo alto del layout viewport.
4. A metà pagina lo scroll muove il layout viewport e l'header resta in vista. Vicino al fondo il layout viewport arriva a fine corsa, e lo scroll che resta sposta il visual viewport dentro il layout viewport. Il bordo alto del layout viewport, con l'header e la barra, esce dalla parte visibile: "sparisce solo vicino al fondo".
5. Il bug colpisce WebKit su iOS, quindi riguarda sia Safari sia la PWA.

Nell'app, il punto che espone al difetto è che la visibilità della barra dipende solo da `.app-header` sticky (`WorkoutPage.tsx:185`, `index.css:119`), che non tiene conto del visual viewport.

## Correzione proposta

Approvata dall'utente il 2026-09-30 sulla base dell'ipotesi 1, anche senza verifica sul dispositivo. La correzione è difensiva: con `offsetTop = 0` non cambia nulla. Se dopo il rilascio il bug resta su iOS 26.0.x, la diagnosi va ripresa.

La modifica più piccola vale solo per l'header della sessione live, dentro cui sta la barra: agganciarlo al visual viewport.

- Un hook `useVisualViewportTop()` in `web/src/lib/`. Legge `window.visualViewport.offsetTop`, lo aggiorna sugli eventi `scroll` e `resize` di `window.visualViewport` e restituisce 0 se l'API non esiste.
- In `WorkoutPage.tsx:185` l'header riceve `style={{ top: offsetTop }}` al posto del `top: 0` di `.app-header`. Resta sticky e occupa ancora il suo spazio in cima alla pagina. Quando iOS sposta il visual viewport, l'header scende con lui e resta nella parte visibile.
- `.app-header` in `index.css` non cambia. Non serve spostare la barra fuori dall'header né renderla `fixed`: `fixed` si aggancia allo stesso layout viewport e avrebbe lo stesso difetto.

Test di regressione (jsdom non calcola il layout, quindi il test simula il visual viewport): un test su `WorkoutPage` sostituisce `window.visualViewport` con un oggetto finto (`offsetTop`, `height`, `addEventListener`/`removeEventListener`), imposta `offsetTop = 300`, invia l'evento `scroll` e verifica che l'`header` che contiene `role="timer"` abbia `style.top` pari a `300px`. Senza la correzione `style.top` è vuoto e il test fallisce. Un secondo caso verifica che senza `window.visualViewport` la pagina funzioni e che l'header non riceva nessun `top`.

## Altri punti colpiti

Se l'ipotesi 1 è confermata, sono esposti allo stesso difetto tutti gli elementi agganciati al layout viewport. Per ora non ci sono segnalazioni su questi punti.

- Header sticky `.app-header` delle altre pagine: `web/src/pages/DayPage.tsx:46`, `web/src/pages/SearchPage.tsx:90`, `web/src/pages/WeekPage.tsx:166`, `web/src/pages/DietStatsPage.tsx:63`, `web/src/pages/SettingsPage.tsx:12`, `web/src/pages/AccountPage.tsx:96`, `web/src/pages/admin/AdminUsersPage.tsx:58`, `web/src/pages/gym/GymStartPage.tsx:104`, `web/src/pages/gym/ExercisesPage.tsx:22`, `web/src/pages/gym/HistoryPage.tsx:25`, `web/src/pages/gym/GymStatsPage.tsx:8`, `web/src/pages/gym/TemplateEditorPage.tsx:166`, `web/src/pages/gym/WorkoutDetailPage.tsx:38`. Più esposte le pagine con campi di testo: `SearchPage` e `TemplateEditorPage`.
- Elementi `fixed` in basso: toast errori della sessione `web/src/pages/gym/WorkoutPage.tsx:49`, tab bar `web/src/components/AppShell.tsx:74`, `web/src/components/gym/ActiveWorkoutBar.tsx:18`, barra azioni `web/src/pages/WeekPage.tsx:228`.

## Impatto sull'esistente

- Comportamenti che cambiano: nella sessione live, quando iOS lascia il visual viewport spostato, l'header (timer manuale, cronometro, "Termina" e barra di riposo) segue la parte visibile dello schermo invece di restare al bordo alto della pagina. In condizioni normali `offsetTop` è 0 e non cambia nulla. Con pinch-zoom o tastiera aperta anche l'header segue la parte visibile. Le altre pagine non cambiano.
- Dati già salvati male: Nessuno

## Criteri di accettazione

- **C1** (riproduzione): Dato un allenamento in corso su iPhone (Safari e PWA) con diversi esercizi e un timer di riposo attivo, dopo aver scritto e confermato un valore in un campo kg o Rip. e con la tastiera chiusa, quando si scorre fino vicino al fondo della pagina, allora la barra del timer di riposo resta visibile in cima allo schermo, e non esce dallo schermo. Stesso risultato senza aver mai toccato un campo.
- **C2** (test di regressione): Esiste un test automatico che esegue i passi del bug. Il test fallisce senza la correzione e passa con la correzione.
- **C3** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano.

## Fuori scope

- Correggere gli header sticky e le barre `fixed` delle altre pagine elencati in "Altri punti colpiti".
- Modifiche a `.app-header` in `web/src/index.css`, condiviso da tutte le pagine.
- Spostare o ridisegnare la barra del timer, per esempio come barra flottante in basso.
- Aggirare altri bug di iOS 26 su `fixed`/`sticky` non legati al visual viewport, come lo slittamento di pochi pixel legato al layout delle schede di Safari.

## Domande aperte

- Risposte dell'utente (2026-09-30): iOS 26.0.x, cioè la versione con il bug WebKit segnalato e non ancora corretto. Quando la barra sparisce, sparisce tutto l'header, come previsto dal codice. Non è noto se il bug compare senza aver mai toccato un campo kg/Rip. Queste risposte sono coerenti con l'ipotesi 1 e rendono improbabile l'ipotesi 3.
- Ancora da verificare, se possibile: se il bug compare anche **subito dopo aver aperto l'allenamento, senza aver mai toccato un campo**; i valori di `visualViewport.offsetTop`, `visualViewport.height` e `innerHeight` vicino al fondo.

  Ipotesi in ordine di probabilità:
  1. **Visual viewport rimasto ridotto/spostato dopo la chiusura della tastiera (bug WebKit di iOS 26).** A favore: durante un allenamento si digita quasi sempre nei campi, quindi "tastiera non aperta" è compatibile con "tastiera aperta e chiusa prima". Colpisce Safari e le web app installate. Il meccanismo (header agganciato al layout viewport, visual viewport che si sposta solo quando il documento è a fine corsa) spiega "solo vicino al fondo, non a metà pagina". È l'unico scenario in cui la barra esce dallo schermo nella riproduzione. Contro: la segnalazione non dice se un campo era stato toccato. Alcuni report parlano di uno scarto di soli 24px, che da solo non basterebbe a nascondere la barra (107-164px dal bordo alto). Segnalato come corretto in iOS 26.1 beta, quindi serve la versione di iOS.
  2. **Altro bug WebKit di iOS 26 su `sticky`/`fixed` vicino ai bordi o alla barra di Safari** (layout delle schede "Compatto"/"In basso"/"In alto", WebKit 297779 sugli elementi fissi che si spostano quando cambia la direzione dello scroll). A favore: specifico di iOS, codice dell'app corretto. Contro: i report descrivono spostamenti di pochi pixel o solo in Safari, non nella PWA.
  3. **Causa nel codice dell'app.** Contro: contenitore sticky esteso a tutta la pagina (misurato), nessun `overflow`/`transform`/secondo contenitore di scroll, nessuna logica legata allo scroll, e il bug non si riproduce in WebKit a nessuna altezza di vista. Da riconsiderare solo se l'utente vede sparire la barra ma non l'header.
