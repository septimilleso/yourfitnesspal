# Spec: IPA, apertura offline con dati in cache, icona e correzioni della feature 1

- Data: 2026-10-12
- Tipo: feature
- Stato: completato
- Brainstorm: saltato

## Obiettivo

L'IPA deve aprirsi anche senza rete, restando nella sessione e mostrando gli ultimi dati già scaricati, invece della schermata "Impossibile contattare il server". Un errore di rete non deve mai far uscire dalla sessione, mentre un 401 vero con rete deve continuare a farlo. Nella stessa feature l'IPA riceve l'icona vera di YFP al posto del placeholder di Capacitor, e si chiudono i 4 MINOR lasciati dalla review della feature 1. La palestra offline completa (ADR 0004) resta per una feature successiva.

## Contesto tecnico

Riferimenti:

- [Brainstorm app-ios-offline](../2026-10-12-app-ios-offline/brainstorm.md), sezione "Aggiunte dopo la feature 1": l'apertura offline e l'icona sono le priorità per la prossima feature. Il fuori scope "Offline per il diario cibo oltre alla lettura da cache" resta valido: qui si fa proprio e solo la lettura da cache.
- [ADR 0003](../../decisions/0003-auth-bearer-client-nativo.md): sessione Bearer conservata sul dispositivo e revocabile dal server. Questa feature non cambia il trasporto, cambia solo quando il token viene rimosso.
- [ADR 0004](../../decisions/0004-palestra-offline-sync-a-blocco.md): stato locale dell'allenamento, outbox e `PUT /workouts/{uuid}` restano fuori. La cache persistente introdotta qui è in sola lettura e non sostituisce lo stato locale previsto dall'ADR.
- [Spec IPA shell](../2026-10-12-ipa-shell-ios/spec.md): l'NFR "Offline" e il criterio C19 accettavano la schermata "Impossibile contattare il server". Questa feature supera quel limite. La [review](../2026-10-12-ipa-shell-ios/review.md) elenca i 4 MINOR e il debito (offline, icona, suono della notifica, isolamento pytest).

Parti coinvolte:

- **Avvio e sessione.** `web/src/main.tsx` chiama `loadNativeSession()` prima del primo render. `web/src/native/session.ts` tiene il token in memoria e in Capacitor Preferences (chiave `yfp.session`). `clearToken()` azzera la memoria e poi chiama `Preferences.remove`, che può rifiutare. Sul web tutte le funzioni sono no-op.
- **Guardia di autenticazione.** `web/src/auth/AuthGuard.tsx` usa `useMe()` (`web/src/auth/AuthContext.tsx`, query `["me"]` su `GET /auth/me`, `retry: false`, `staleTime` 5 minuti). Su un `ApiError` 401 va a `/login`. Su qualsiasi altro errore, compreso il rifiuto di `fetch` senza rete, mostra "Impossibile contattare il server" con "Riprova". Senza dati va a `/login`.
- **Client HTTP.** `web/src/api/client.ts`: in nativo invia `Authorization: Bearer`, `X-YFP-Client: native` e `credentials: "omit"`. A riga 60-63, su un 401 con `detail === "unauthorized"` chiama `clearToken()` senza confrontare il token usato dalla richiesta con quello corrente (MINOR c). Un errore di rete fa rifiutare `fetch` con un errore che non è `ApiError`, quindi oggi non tocca il token.
- **Login.** `web/src/api/auth.ts`: `verifyTotp` e `setupComplete` salvano il token con `setToken` tramite `keepNativeSession`. Il flusso di pagina è in `web/src/pages/LoginPage.tsx`.
- **React Query.** `web/src/App.tsx` crea un solo `QueryClient` con `QueryCache` e `MutationCache` che, su 401 (escluso `["me"]` per le query), impostano `["me"]` a `null` e lo invalidano. Non c'è persistenza della cache: alla chiusura dell'app tutto si perde. `gcTime` è quello di default (5 minuti), il `networkMode` è quello di default. Nessuna mutazione usa aggiornamenti ottimistici (`onMutate` assente). Le mutazioni della palestra scrivono `gymKeys.active` con `setQueryData` (`web/src/api/gym.ts:395`, `:406`, `:422`, `:435`).
- **Logout.** `useLogout` in `web/src/auth/AuthContext.tsx`: in nativo cancella la notifica di riposo (riga 45), chiama `logout()` ignorando gli errori, poi `await clearToken()` senza catch (riga 52, MINOR b), quindi `clearClientCaches` (`queryClient.clear()` più `api-foods-cache` del service worker) e naviga a `/login`. La cancellazione della notifica avviene prima dello svuotamento della cache (MINOR a).
- **Notifiche di riposo.** `web/src/native/NativeBridge.tsx` si iscrive alla `QueryCache` e chiama `syncRestNotification` a ogni aggiornamento riuscito di `gymKeys.active`. `web/src/native/restNotifications.ts` serializza in coda schedulazioni e cancellazioni (id fisso 4101). Il timer in primo piano (`web/src/components/gym/RestTimerBar.tsx`) calcola l'offset con `clockOffsetMs(workout.server_now, Date.now())` (`web/src/lib/restTimer.ts`): con un `Workout` vecchio di ore l'offset sarebbe sbagliato e il riposo risulterebbe ancora in corso.
- **Icona.** `web/ios/App/App/Assets.xcassets/AppIcon.appiconset/` contiene un solo `AppIcon-512@2x.png` 1024x1024, il placeholder di Capacitor (croce blu su griglia), introdotto dal commit `88bb3c2`. L'art di YFP è in `web/art/dieta/app-icon.png` e `web/art/palestra/app-icon.png`, entrambe 1254x1254 RGBA con angoli arrotondati trasparenti. `web/scripts/build-art.py` (`pwa_icons()`) genera le icone PWA da `web/art/dieta/app-icon.png`, comprese le versioni opache a piena area (`pwa-maskable-512x512.png`, `apple-touch-icon.png` 180x180). La sorgente è quindi adatta a un'icona iOS 1024x1024.
- **CI.** `.github/workflows/ios-release.yml`: `TAG` viene da `inputs.tag` o da `github.ref_name`. A riga 41 `actions/checkout@v4` non ha `ref`, quindi con `workflow_dispatch` costruisce il branch scelto e non il tag. `softprops/action-gh-release` crea il tag su GitHub se manca (MINOR d).
- **Documentazione.** `README.md`, sezione "iOS app (IPA)": "Notes on this version" dice "Network required" e il punto 4 di "Releasing" descrive il ripiego `workflow_dispatch`.

Vincoli:

- Gitea (`origin`) è la fonte; GitHub è solo un push mirror, nessuna scrittura diretta su GitHub.
- `cd web && npm test` gira in locale; pytest solo sul deploy remoto. Questa feature non tocca l'API.
- Distribuzione con SideStore e account Apple gratuito: nessuna extension e nessun App ID in più.

## Impatto sull'esistente

- Comportamenti che cambiano:
  - Nell'IPA, aprendo l'app senza rete con una sessione salvata, si entra nell'app con gli ultimi dati scaricati invece di vedere "Impossibile contattare il server".
  - Nell'IPA i dati letti online restano sul dispositivo tra una chiusura e l'altra dell'app, e vengono cancellati quando la sessione finisce.
  - Nell'IPA, offline con dati in cache, compare una barra "Offline, dati delle <ora>".
  - L'IPA mostra l'icona di YFP sulla schermata Home.
  - Al logout nativo non resta nessuna notifica di riposo pendente, anche in caso di aggiornamenti tardivi dell'allenamento; un errore nel rimuovere il token non blocca più il logout.
  - Un 401 arrivato dopo un nuovo login non cancella più il token appena salvato.
  - Con `workflow_dispatch` il workflow costruisce il commit del tag indicato e non crea tag su GitHub.
- Comportamenti da preservare:
  - Web e PWA: nessuna persistenza nuova della cache, chiamate su `/api` con cookie, `AuthGuard` invariato (senza rete mostra "Impossibile contattare il server" con "Riprova"), service worker con `sw.js`, `autoUpdate`, `api-foods-cache` svuotata al logout.
  - Un 401 di sessione (token scaduto, revocato, `auth_version` superata) con rete porta al login sia sul web sia nell'IPA.
  - Login password più TOTP, setup TOTP e recovery code identici, sul web e nell'IPA; un 401 con detail diverso da `unauthorized` (credenziali errate) non rimuove il token.
  - Notifiche locali di fine riposo dell'IPA (R9-R10 della feature 1): programmazione, sostituzione, cancellazione su Salta, fine, annullamento, logout; tocco che apre `/gym/workout`.
  - Timer di riposo, campanella e aptico in primo piano con dati freschi dal server.
  - Web Push della PWA invariato.
  - Build PWA (`npm run build`) con `sw.js` e `registerSW.js`; build nativa (`npm run build:native`) senza service worker, con URL assoluto, e che fallisce senza `VITE_API_BASE_URL`.
  - Workflow iOS al push di un tag `v*`: controllo del formato del tag, IPA `yourfitnesspal-<tag>.ipa`, versione uguale al tag, release GitHub e Gitea.
- Compatibilità: retrocompatibile. Nessun endpoint e nessun formato API cambiano. La cache persistente è nuova e locale all'IPA: una versione precedente dell'IPA non ne ha, quindi il primo avvio dopo l'aggiornamento si comporta come oggi finché non si è letto qualcosa online.
- Migrazioni: nessuna migrazione DB né di configurazione. Il token già salvato dalla feature 1 (chiave `yfp.session`) resta valido: l'aggiornamento dell'IPA non richiede un nuovo login.

## Requisiti funzionali

Apertura offline (solo IPA):

- **R1**: L'IPA deve conservare sul dispositivo i dati delle letture API riuscite dell'utente autenticato, compreso l'utente corrente (`/auth/me`), così che sopravvivano alla chiusura dell'app dal multitasking e al riavvio del telefono. La cache non deve mai contenere il token. Nel browser e nella PWA non deve esserci nessuna persistenza nuova.
- **R2**: Aprendo l'IPA senza rete, con un token salvato e l'utente corrente in cache, l'app deve entrare nella parte autenticata senza mostrare "Impossibile contattare il server" e senza andare al login. Ogni schermata protetta deve aprirsi: se i suoi dati sono in cache li mostra; se non ci sono mostra il proprio stato di errore o vuoto, restando nella sessione. "Ultimi dati in cache" significa: i dati che quella schermata ha ricevuto dal server l'ultima volta che è stata aperta online,. Non c'è un'età massima: la cache resta valida finché la sessione è valida (R5, R9).
- **R3**: Aprendo l'IPA senza rete, con un token salvato ma senza l'utente corrente in cache (per esempio la prima apertura dopo l'installazione o una cache scaduta), l'app deve mostrare la schermata "Impossibile contattare il server" con "Riprova", senza andare al login e senza rimuovere il token. Senza token deve mostrare il login, come oggi.
- **R4**: Nell'IPA un errore che non sia un 401 di sessione (rete assente, timeout, risposta 5xx, risposta non JSON da un proxy) non deve rimuovere il token, non deve cancellare la cache persistente e non deve portare al login, qualunque sia la chiamata (lettura, scrittura o `/auth/me`).
- **R5**: Nell'IPA un 401 con `detail` `unauthorized` ricevuto dal server per il token corrente deve, come oggi, rimuovere il token e portare al login; inoltre deve cancellare la cache persistente.
- **R6**: Quando la rete torna (o l'app torna in primo piano con la rete), i dati delle schermate aperte devono aggiornarsi dal server senza riavviare l'app. Se nel frattempo la sessione è stata revocata, si applica R5.
- **R7**: Nell'IPA, senza rete, le scritture (aggiungere cibo, completare una serie, salvare un template e simili) devono fallire come falliscono oggi, con l'errore della schermata, senza coda e senza mostrare come salvata una modifica che il server non ha accettato. Valgono R4 e R6.
- **R8**: Un allenamento attivo letto dalla cache persistente non deve produrre segnali di riposo falsi: nessuna campanella, nessun feedback aptico, nessun conto alla rovescia del riposo calcolato su dati vecchi, e nessuna notifica locale programmata o cancellata per effetto del solo caricamento dalla cache. Una notifica programmata online prima della chiusura dell'app deve restare valida.
- **R9**: Il logout dall'IPA deve cancellare la cache persistente, anche senza rete, oltre a quanto fa oggi (token rimosso, cache in memoria svuotata, navigazione al login).

- **R16**: Nell'IPA, quando l'app non ha rete e mostra dati letti dalla cache, deve comparire una barra visibile "Offline, dati delle <ora>", dove l'ora è quella dell'ultimo aggiornamento riuscito dei dati mostrati. La barra sparisce quando la rete torna e i dati si sono aggiornati (R6). Con la rete presente non compare. Nel browser e nella PWA non compare.

Icona (solo IPA):

- **R10**: L'IPA deve usare come icona il gatto chef di YFP ricavato da `web/art/dieta/app-icon.png`, la stessa sorgente delle icone PWA: PNG 1024x1024, opaca (senza canale alfa) e a piena area, senza gli angoli arrotondati trasparenti della sorgente, perché iOS applica la propria maschera. Il placeholder di Capacitor deve sparire dal progetto. L'icona deve essere rigenerabile dalla sorgente con la pipeline dell'art esistente (`web/scripts/build-art.py`), senza toccare le icone PWA già generate.

Correzioni della review della feature 1:

- **R11** (MINOR a): Al termine del logout nativo non deve esserci nessuna notifica di riposo pendente, anche se un aggiornamento dell'allenamento attivo arriva durante il logout e riprogramma la notifica prima dello svuotamento della cache. Un errore nella cancellazione non deve bloccare il logout.
- **R12** (MINOR b): Se la rimozione del token dallo storage del dispositivo fallisce, il logout nativo deve comunque completarsi, svuotare le cache e portare al login; il token non deve più essere inviato nelle chiamate successive della stessa esecuzione dell'app.
- **R13** (MINOR c): Un 401 `unauthorized` deve rimuovere il token solo se è la risposta a una richiesta partita con il token ancora salvato. Se nel frattempo è stato salvato un token diverso (per esempio da un nuovo login), quel token deve restare.
- **R14** (MINOR d): Con `workflow_dispatch` il workflow `ios-release.yml` deve costruire l'IPA dal commit del tag indicato in `tag`, non dal branch scelto. Se il tag non esiste su GitHub, il run deve fallire prima di pubblicare e non deve creare il tag su GitHub. Al push di un tag il comportamento resta quello di oggi.
- **R15**: Il `README.md`, sezione "iOS app (IPA)", deve descrivere l'apertura offline in sola lettura e i suoi limiti (scritture e palestra offline non disponibili, prima apertura senza rete), sostituendo la nota "Network required", e deve dire che il ripiego `workflow_dispatch` costruisce il tag indicato, che deve già esistere su GitHub tramite il mirror.

## Requisiti non funzionali

- Sicurezza: la cache persistente contiene dati personali (diario, pesi, allenamenti). Resta nella sandbox dell'app, non contiene mai il token, non viene scritta nei log e viene cancellata a fine sessione (R5, R9).
- Durata: la cache persistente deve stare in uno storage dell'app che iOS non svuota per inattività, con lo stesso criterio di affidabilità del token (ADR 0003). Lo storage della WebView soggetto alla pulizia di WebKit non soddisfa questo requisito da solo.
- Compatibilità tra versioni: un'IPA nuova non deve mostrare dati in cache scritti da una versione con formato incompatibile; in quel caso la cache si scarta e si torna a R3.
- Prestazioni: con la cache presente, l'apertura offline deve mostrare la prima schermata senza attendere timeout di rete percepibili (indicativamente entro 2 s dall'avvio della WebView). La scrittura della cache non deve rallentare le interazioni.
- Isolamento: la persistenza e il nuovo comportamento offline si attivano solo su piattaforma nativa. In jsdom (`npm test`) e nel browser i plugin nativi non vengono chiamati, come per la feature 1.

## Criteri di accettazione

Verificabili con test automatici in locale (`cd web && npm test`):

- **C1** (R1, R2): Dato il client in modalità nativa con un token e una cache persistita che contiene l'utente corrente e i dati di una schermata protetta, quando l'app si avvia e ogni `fetch` rifiuta per rete assente, allora la schermata mostra i dati della cache, non compare "Impossibile contattare il server" e non si va su `/login`.
- **C2** (R3): Dato il client nativo con un token e senza utente corrente in cache, quando `/auth/me` rifiuta per rete assente, allora compare "Impossibile contattare il server" con "Riprova" e il token è ancora salvato. Dato il client nativo senza token, compare il login.
- **C3** (R4): Dato il client nativo con un token, quando una chiamata rifiuta per rete assente oppure riceve 500, 502 o una risposta non JSON, allora il token resta salvato, la cache persistente resta e non avviene nessuna navigazione verso `/login`.
- **C4** (R5): Dato il client nativo con un token e una cache persistita, quando `/auth/me` o un'altra chiamata riceve 401 `unauthorized` per quel token, allora il token viene rimosso, la cache persistente viene cancellata e l'app va su `/login`.
- **C5** (R6): Dati i dati di una schermata mostrati dalla cache con la rete assente, quando la rete torna, allora la chiamata di quella schermata viene ripetuta e la schermata mostra la risposta nuova senza rimontare l'app.
- **C6** (R8): Dato un allenamento attivo in cache con `rest_ends_at` e `server_now` di ore prima, quando l'app lo carica dalla cache senza rete, allora `beep`, la funzione aptica, `LocalNotifications.schedule` e `LocalNotifications.cancel` non vengono chiamati e la barra del riposo non mostra un conto alla rovescia.
- **C7** (R9): Dato il client nativo con una cache persistita, quando l'utente fa logout e la chiamata `logout()` rifiuta per rete assente, allora la cache persistente è cancellata, il token è rimosso e l'app è su `/login`.
- **C8** (R11): Dato un logout nativo durante il quale un aggiornamento riuscito di `gymKeys.active` con `rest_ends_at` futuro arriva dopo la prima cancellazione, quando il logout termina, allora l'ultima operazione sulla notifica 4101 è una cancellazione. Se la cancellazione rifiuta, il logout arriva comunque a `/login`.
- **C9** (R12): Dato un logout nativo in cui `Preferences.remove` rifiuta, quando l'utente fa logout, allora `useLogout` non lancia, le cache sono svuotate, l'app è su `/login` e la chiamata successiva non contiene `Authorization`.
- **C10** (R13): Data una richiesta nativa partita con il token A, quando prima della sua risposta 401 `unauthorized` viene salvato il token B, allora dopo la risposta il token salvato è ancora B. Se il token salvato è ancora A, viene rimosso come oggi.

- **C27** (R16): Dato il client nativo con dati in cache e `fetch` che rifiuta per rete assente, quando la schermata mostra i dati della cache, allora compare la barra "Offline, dati delle <ora>" con l'ora dell'ultimo aggiornamento riuscito. Quando la rete torna e la chiamata riesce, la barra sparisce. Con la rete presente, e nel client web, la barra non compare mai.

Verificabili con comandi o ispezione dei file:

- **C11** (R10): Il file in `web/ios/App/App/Assets.xcassets/AppIcon.appiconset/` referenziato da `Contents.json` è un PNG 1024x1024 senza canale alfa (per esempio `file` riporta `1024 x 1024, 8-bit/color RGB`), ricavato da `web/art/dieta/app-icon.png`, e il placeholder di Capacitor non è più presente. Rieseguendo `python web/scripts/build-art.py` l'icona iOS viene rigenerata uguale e le icone PWA in `web/public/` non cambiano.
- **C12** (R14): Nel file `.github/workflows/ios-release.yml` il passo di checkout usa il tag `TAG` come riferimento, sia per il push di un tag sia per `workflow_dispatch`.
- **C13** (R15): Il `README.md` non contiene più la nota "Network required" e descrive l'apertura offline in sola lettura, i suoi limiti e il comportamento di `workflow_dispatch`.

Verificabili in CI (run "iOS release" su GitHub):

- **C14** (R14): Dato un tag `v*` esistente su GitHub tramite il mirror, quando si lancia "iOS release" con `workflow_dispatch` da `main` indicando quel tag, allora il log del checkout mostra il commit del tag e l'IPA pubblicata ha la versione del tag. Dato un tag inesistente, il run fallisce prima del passo "GitHub release" e su GitHub non compare il tag.
- **C15** (R10, preservare): Al push di un nuovo tag `v*` su Gitea, il run parte dal mirror e pubblica `yourfitnesspal-<tag>.ipa` sulle release GitHub e Gitea, con `CFBundleShortVersionString` uguale al tag senza `v`, come nella feature 1.

Verificabili solo sul dispositivo (iPhone, iOS 26, SideStore, IPA di C15):

- **C16** (R10): Installata l'IPA, sulla schermata Home compare l'icona del gatto di YFP e non il placeholder di Capacitor.
- **C17** (R1, R2): Dopo un login online e l'apertura di diario di oggi, settimana, palestra, storico allenamenti e statistiche, si chiude l'app dal multitasking, si attiva la modalità aereo e la si riapre. L'app entra senza login e senza "Impossibile contattare il server", e quelle schermate mostrano i dati visti prima, con la barra "Offline, dati delle <ora>" (R16). Lo stesso vale dopo il riavvio del telefono. Riattivata la rete, la barra sparisce.
- **C18** (R4, R6, R7): In modalità aereo un'azione di scrittura mostra un errore e non fa uscire dalla sessione. Disattivata la modalità aereo, i dati si aggiornano senza riaprire l'app e la stessa azione riesce.
- **C19** (R5): Revocata dal browser la sessione dell'IPA, alla prima apertura con rete l'IPA va al login; riaprendola poi in modalità aereo non mostra dati della sessione revocata.
- **C20** (R8): Avviato un riposo con avviso attivo, si chiude l'app, si attiva la modalità aereo e la si riapre dopo la fine del riposo: non suona la campanella, non c'è un conto alla rovescia del riposo e la notifica già programmata arriva una sola volta all'ora prevista.

Comportamenti da preservare:

- **C21** (preservare): Dato il browser o la PWA, quando `/auth/me` fallisce per rete assente, allora compare "Impossibile contattare il server" con "Riprova" come oggi, e nessun dato viene persistito fuori dal service worker. I test esistenti `web/src/auth/AuthGuard.test.tsx`, `web/src/auth/AuthContext.test.tsx`, `web/src/api/client.test.ts`, `web/src/api/weights.test.tsx` e `web/src/api/savedWeeks.test.tsx` passano senza modifiche.
- **C22** (preservare): Dato un 401 con `detail` diverso da `unauthorized` (credenziali errate al login), il token non viene rimosso; dato un 401 `unauthorized`, il token viene rimosso. I test esistenti `web/src/api/client.native.test.ts`, `web/src/api/auth.native.test.ts`, `web/src/auth/AuthContext.native.test.tsx` e `web/src/pages/LoginPage.test.tsx` passano, modificati al massimo per le asserzioni toccate da R11-R13.
- **C23** (preservare): Dato un allenamento con dati freschi dal server, quando si completa una serie, si usano ±15 s, Salta, fine o annullamento, allora notifica locale, campanella e aptico si comportano come nella feature 1. I test esistenti `web/src/native/restNotifications.test.ts`, `web/src/native/NativeBridge.test.tsx`, `web/src/native/haptics.test.ts`, `web/src/components/gym/RestTimerBar.test.tsx`, `web/src/components/gym/RestTimerBar.native.test.tsx`, `web/src/lib/push.test.ts` e `web/src/components/RestAlertSetting.test.tsx` restano verdi.
- **C24** (preservare): Eseguendo `cd web && npm run build`, la build termina e `dist/` contiene `sw.js` e `registerSW.js`. Eseguendo `cd web && VITE_API_BASE_URL=https://pal.septimilleso.uk/api npm run build:native`, l'output non contiene `sw.js` né `registerSW.js` e contiene l'URL assoluto; senza `VITE_API_BASE_URL` la build nativa fallisce con il messaggio esplicito di oggi.
- **C25** (preservare): Dato un utente con l'IPA online, il login password più TOTP (e il setup TOTP) porta al diario, e dopo chiusura e riapertura con rete l'app resta autenticata, come in C15 della feature 1.

Non regressione:

- **C26** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano, anche quelli esistenti.

## Fuori scope

- Palestra offline completa: stato locale dell'allenamento, reducer client, outbox, sync a blocco, endpoint `PUT /workouts/{uuid}` idempotente con versione, indicatore "da sincronizzare" (ADR 0004).
- Scritture offline di qualsiasi tipo e coda delle mutazioni.
- Scaricamento preventivo (prefetch) di dati mai aperti online.
- Ricerca cibo e barcode offline nell'IPA.
- Live Activity e Dynamic Island.
- HealthKit.
- Suono personalizzato della notifica di fine riposo: il follow-up della review su `rest-bell.wav` (oggi suona il suono di sistema) resta aperto e non si tocca qui.
- APNs e push remoti.
- Isolamento dei test pytest (24 fallimenti preesistenti sul DB condiviso).
- Splash screen dell'IPA e icone PWA: restano come sono.
- Gli avvisi "accettabili senza task" della review della feature 1 (`auth.ts:13-15`, `NativeRestAlertSetting.tsx`, `extra.url`, `X-YFP-Challenge`, `Package.swift`, test di `RestTimerBar.native`).

## Rischi

- **Query in pausa senza rete.** React Query può mettere in pausa le query quando il dispositivo risulta offline; con `["me"]` in pausa e senza dati, `AuthGuard` oggi non è in caricamento né in errore e va su `/login`. Mitigazione: C1, C2 e C17 coprono sia rete assente con `navigator.onLine` falso sia `fetch` che rifiuta.
- **Cache scartata prima di essere persistita.** Con `gcTime` di default (5 minuti) le query non osservate escono dalla cache e non vengono ripristinate. Mitigazione: C17 apre più schermate e chiude l'app dopo qualche minuto.
- **Storage della WebView svuotato da iOS.** Se la cache finisse nello storage di WebKit, iOS potrebbe cancellarla; il token in Preferences resterebbe e si ricadrebbe in R3. Mitigazione: NFR "Durata" e C17 dopo il riavvio del telefono.
- **Dimensione della cache.** Risultati di ricerca e storici possono pesare; uno storage pensato per valori piccoli potrebbe rallentare l'avvio. Mitigazione: NFR "Prestazioni"; il piano decide quali chiavi escludere.
- **Allenamento attivo vecchio.** Un `Workout` in cache con `server_now` vecchio darebbe un riposo falso e potrebbe riprogrammare o cancellare la notifica. Mitigazione: R8, C6, C20.
- **Dati personali sul dispositivo.** Una cache che sopravvive alla fine della sessione esporrebbe dati a chi prende il telefono dopo un logout. Mitigazione: R5, R9, C4, C7, C19.
- **Icona ricampionata.** Il ritaglio opaco a piena area della sorgente 1254x1254 potrebbe risultare poco sotto i 1024 px e richiedere un leggero ingrandimento della pixel art. Mitigazione: verifica visiva in C16.
- **`workflow_dispatch` su tag assente.** Con il checkout sul tag, un run manuale lanciato prima che il mirror inoltri il tag fallisce. È il comportamento voluto (R14), va solo documentato (R15).

## Decisioni prese con l'utente

- Età massima della cache: nessun limite finché la sessione è valida.
- Indicatore offline: sì, barra "Offline, dati delle <ora>" (R16, C27).
- Icona: gatto chef di `web/art/dieta/app-icon.png`.

## Domande aperte

Nessuna.
