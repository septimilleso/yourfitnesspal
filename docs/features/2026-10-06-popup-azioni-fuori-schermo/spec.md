# Bug: popup menu "•••" esce fuori dallo schermo in PWA

- Data: 2026-10-06
- Tipo: bug
- Stato: approvata

## Sintomo

Toccando i 3 pallini ("•••") su una card (allenamento/scheda) in PWA, il popup con le opzioni esce fuori dallo schermo e non si vede tutto.

## Passi per riprodurre

1. Aprire la PWA, sezione palestra, lista schede/allenamenti.
2. Toccare "•••" su una card in basso nella schermata.

## Atteso e osservato

- Atteso: popup interamente visibile, con tutte le opzioni raggiungibili.
- Osservato: popup tagliato sotto il bordo dello schermo.

## Ambiente

PWA (mobile). Sempre, quando la card è vicina al bordo inferiore. Da quando: da introduzione di `ActionMenu` (commit 7375581). Lo storico di design (`docs/superpowers/specs/2026-09-24-gym-workouts-design.md`, righe 301-330) descrive solo il contenuto dei menu, non il posizionamento: nessuna decisione da rispettare.

## Causa radice

`web/src/components/gym/ActionMenu.tsx` posiziona il menu in modo fisso rispetto al trigger, senza mai guardare il viewport:

- `ActionMenu.tsx:22` il wrapper è `relative`; `ActionMenu.tsx:41` il menu è `absolute right-0 mt-1 w-56`. Quindi si apre sempre sotto il trigger (`mt-1`, mai `bottom-full`) e sempre allineato al bordo destro del trigger, largo 224 px (`w-56`).
- Non c'è alcuna misura (`getBoundingClientRect`, `window.innerHeight/innerWidth`), né flip verso l'alto, né clamp orizzontale, né margine per la safe area o per la tab bar fissa.

Catena causa → sintomo, asse verticale (quello segnalato): card vicina al fondo dello schermo → trigger a pochi px dal bordo inferiore → il menu (4 voci in `TemplateCard.tsx:28-33`, circa 190 px) parte sotto il trigger e supera `window.innerHeight` → la parte bassa è fuori dal viewport. In PWA iOS la parte bassa è anche sotto la tab bar fissa di `AppShell.tsx:72-74` (altezza `--nav-height` = 3.25rem + `env(safe-area-inset-bottom)`, `web/src/index.css:18-19`) e sotto la home indicator, e il body ha `overscroll-behavior-y: none` (`index.css:31`), quindi non c'è alcun segnale che si possa scorrere per vedere il resto. Il menu è `z-50`, sopra la nav (`z-30`), perciò non è la nav a nasconderlo ma il bordo del viewport.

Secondo difetto dello stesso codice, asse orizzontale: `right-0` ancora il bordo destro del menu al bordo destro del trigger, e il menu è largo 224 px. Il trigger sta nella card a sinistra della griglia 2 colonne (`GymStartPage.tsx:82`, `grid grid-cols-2 gap-3`, card larghe circa 165-173 px su 375-390 px di viewport): bordo destro del trigger a circa x=170-177, quindi il menu parte a circa x=-47/-54 e la sua parte sinistra, dove inizia il testo delle voci, è fuori dallo schermo. Nel caso `SetRow` (vedi sotto) il trigger è nella prima colonna da 2.25rem (`web/src/lib/gym.ts:76`), a circa x=32-68: il menu parte a circa x=-156.

Esclusi dall'indagine: clipping da `overflow-hidden` degli antenati. `TemplateCard.tsx:17` usa `.card` (`index.css:64-66`: bordo, sfondo, ombra, nessun overflow) e la griglia/le sezioni di `GymStartPage.tsx` non hanno overflow; nessun uso di `ActionMenu` sta dentro un antenato con `overflow-hidden` (la `section.card.overflow-hidden` di `SavedWeekDetailPage.tsx:103` contiene i giorni, mentre il menu è nell'header, righe 70-78). Il difetto è quindi il posizionamento, non il clipping.

Non verificato su dispositivo: i valori in px sono stimati dalle classi Tailwind e da larghezze tipiche di iPhone, non misurati sulla PWA.

## Correzione proposta

Modifica minima, solo in `web/src/components/gym/ActionMenu.tsx`: all'apertura misurare e scegliere il lato, tenendo il menu `absolute` dentro il wrapper `relative` esistente.

- All'apertura (in `useLayoutEffect` sullo stato `open`, prima del paint) leggere `getBoundingClientRect()` del wrapper/trigger e del menu (ref sul `<ul>`), più `window.innerHeight` e `window.innerWidth`.
- Verticale: se lo spazio sotto il trigger (viewport meno altezza della tab bar fissa, che include già la safe area, meno un margine di circa 8 px) è minore dell'altezza del menu e sopra c'è più spazio che sotto, aprire verso l'alto (`bottom-full mb-1` al posto di `mt-1`). Altrimenti resta come oggi.
- Orizzontale: tenere `right-0` se `trigger.right - larghezza menu >= margine`; altrimenti usare `left-0`. Questo copre card di sinistra e `SetRow`.
- Esporre la scelta in modo testabile (classi o attributo `data-placement`/`data-align` sul `<ul>`), senza cambiare le props pubbliche (`label`, `actions`, `trigger`, `triggerClassName`). Nessun chiamante va modificato.
- Il menu resta `absolute`: così non si introduce portal né `position: fixed`. Alternativa scartata come più invasiva: portal su `document.body` con `fixed` e clamp numerico. Sarebbe più robusta ma è una riscrittura, e un `fixed` dentro `.app-header` (che ha `backdrop-blur-xl`, quindi crea un containing block) sarebbe relativo all'header, non al viewport.

## Altri punti colpiti

Tutti gli usi usano lo stesso `ActionMenu` e sono corretti dalla stessa modifica; non serve toccare i file chiamanti. Per ciascuno, il difetto che si manifesta:

- `web/src/components/gym/TemplateCard.tsx:26` (lista modelli, `GymStartPage`): sia flip verticale (card in basso) sia clamp orizzontale (card nella colonna sinistra). È il caso segnalato.
- `web/src/pages/gym/GymStartPage.tsx:155` (menu cartella, Rinomina/Elimina cartella): trigger a destra, riga di intestazione; flip verticale se la cartella è vicina al fondo.
- `web/src/components/gym/SetRow.tsx:100` (numero serie, "Elimina serie"): trigger nella prima colonna stretta, menu quasi tutto fuori a sinistra; serve `left-0`. Anche flip verticale per le ultime serie.
- `web/src/components/gym/WorkoutExerciseCard.tsx:40` (allenamento attivo): trigger in alto a destra della card, flip verticale per card in fondo.
- `web/src/pages/gym/TemplateEditorPage.tsx:235` (editor modello): come sopra.
- `web/src/pages/gym/WorkoutDetailPage.tsx:46` e `web/src/pages/SavedWeekDetailPage.tsx:71`: nell'header in alto, aperti verso il basso hanno spazio; non sono affetti dal bug, ma non devono regredire (restano in basso, allineati a destra).
- `web/src/pages/gym/WorkoutPage.tsx:12` importa solo il tipo `Action`, nessun uso del componente.

Difetto collegato, non corretto qui: nei due menu dell'header il backdrop `fixed inset-0 z-40` (`ActionMenu.tsx:38`) ha come containing block l'header (`backdrop-blur-xl` in `index.css:119`), quindi il tap fuori dall'header non chiude il menu. Vedi Fuori scope.

## Impatto sull'esistente

- Comportamenti che cambiano: i menu vicini al bordo inferiore si aprono verso l'alto, quelli il cui trigger è vicino al bordo sinistro si allineano a sinistra del trigger. Nelle posizioni con spazio sufficiente nulla cambia. Nessun cambio di props, di azioni o di API.
- Dati già salvati male: Nessuno

## Criteri di accettazione

- **C1** (riproduzione): Dato un viewport di 390x700 e una `TemplateCard` il cui trigger "Azioni <nome>" è a circa 90 px dal bordo inferiore (posizione simulata con `getBoundingClientRect`), quando si tocca "•••", allora il menu si apre verso l'alto e resta interamente dentro il viewport (nessuna voce sotto il bordo), e non si apre sotto il trigger superandone il bordo inferiore. Dato lo stesso viewport e un trigger vicino al bordo sinistro (card di sinistra o `SetRow`), allora il menu è allineato a sinistra del trigger e non esce dal bordo sinistro. Dato un trigger in alto con spazio sotto, allora il menu resta sotto, allineato a destra, come oggi.
- **C2** (test di regressione): Esiste un test automatico che esegue i passi del bug. Il test fallisce senza la correzione e passa con la correzione. Nuovo `web/src/components/gym/ActionMenu.test.tsx` (vitest + Testing Library, ambiente jsdom). jsdom non calcola il layout, quindi: impostare `window.innerWidth/innerHeight` (390x700), mockare `HTMLElement.prototype.getBoundingClientRect` con `vi.spyOn` restituendo un rettangolo per il trigger (identificato dall'`aria-label`, es. top 600, bottom 630) e uno per il menu (`role="menu"`, altezza circa 190, larghezza 224), cliccare il trigger, verificare la scelta di lato (classe o `data-placement`/`data-align`). Casi minimi: trigger in basso, il menu va in alto; trigger in alto, il menu resta sotto; trigger a sinistra, allineamento a sinistra. Almeno il primo caso va eseguito rendendo `TemplateCard`, per riprodurre il percorso utente. Ripristinare i mock in `afterEach`.
- **C3** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano. In particolare restano verdi `SetRow.test.tsx`, `WorkoutDetailPage.test.tsx`, `SavedWeekDetailPage.test.tsx` e `WeekPage.test.tsx`, che aprono il menu senza mock del layout (in jsdom i rettangoli sono tutti a zero: il posizionamento di default non deve rompere `getByRole("menuitem")`).

## Fuori scope

- Portal su `document.body` e posizionamento `fixed` con clamp numerico (riscrittura più ampia).
- Il backdrop che non copre il viewport nei menu dell'header (`WorkoutDetailPage`, `SavedWeekDetailPage`), causato da `backdrop-blur` sull'header.
- Larghezza del menu su viewport molto stretti (sotto circa 320 px) e menu più alti dello spazio disponibile in entrambe le direzioni (scroll interno, `max-height`).
- Riposizionamento durante scroll, rotazione o apertura della tastiera con il menu già aperto: la posizione si calcola solo all'apertura.
- Altri popup/sheet dell'app (`Sheet.tsx` e dialog sono già `fixed inset-0`).

## Domande aperte

- Decisione utente: il fix include anche il taglio a sinistra (stesso componente, stessa causa).
- Da decidere in fase di piano: limite inferiore del flip, leggendo l'elemento `nav[aria-label="Navigazione principale"]` oppure con margine costante (`--nav-height` non è leggibile in JS).
- Il taglio è dedotto dal codice, non osservato su iPhone (PWA): verifica manuale a fine implementazione.
