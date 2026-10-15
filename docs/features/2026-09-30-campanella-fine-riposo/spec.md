# Spec: Campanella a fine riposo

- Data: 2026-09-30
- Tipo: feature
- Stato: completato
- Brainstorm: [brainstorm.md](brainstorm.md)

## Obiettivo

A fine riposo l'utente deve sentire un avviso negli auricolari sia con YFP in primo piano, sia in background, sia a schermo bloccato, sulla PWA installata su iPhone. In primo piano suona una campanella in-app che si mixa con la musica; in background e a schermo bloccato arriva una notifica Web Push inviata dal server alla scadenza di `rest_ends_at` (approccio A del brainstorm, [ADR 0001](../../decisions/0001-web-push-scheduler-in-process.md)).

## Contesto tecnico

Decisioni precedenti che questa feature cambia. La spec della palestra ([2026-09-24-gym-workouts-design.md](../../superpowers/specs/2026-09-24-gym-workouts-design.md)) aveva deciso "Timer di riposo solo in-app (beep WebAudio + vibrazione)" e metteva "Notifiche push" fuori scope. Questa feature supera entrambe le decisioni, solo per l'avviso di fine riposo. Restano valide le altre decisioni sul timer: istante assoluto `rest_ends_at`, correzione dell'offset con `server_now`, `POST /workouts/{id}/rest` con `start_s` / `delta_s` / `skip`. Resta valida anche la correzione recente dell'header agganciato al visual viewport ([2026-09-30-timer-riposo-scompare-scroll](../2026-09-30-timer-riposo-scompare-scroll/spec.md)).

Parti coinvolte:

- **Timer lato server.** `api/app/services/workouts.py`: `_start_rest` e `_clear_rest` (righe 424-431), `complete_set` avvia il riposo, `rest` gestisce start/±15/salta (righe 467-482), `finish_workout` azzera il timer, `delete_workout` elimina il workout in corso. Modello `Workout` in `api/app/models/workout.py` (campi `rest_ends_at`, `rest_total_s`). Nessun tool MCP modifica il timer.
- **Avvio dell'API.** `lifespan` in `api/app/main.py` gestisce già risorse di processo (OffClient, session manager MCP). L'API gira come un solo processo uvicorn (`api/Dockerfile`). Il middleware CSRF richiede `X-Requested-With: yfp` sulle scritture sotto `/api/`.
- **Configurazione.** `api/app/config.py` (pydantic-settings da env/`.env`), `.env.example`, `docker-compose.yml` (servizio `api` con `env_file: .env`). Dipendenze in `api/pyproject.toml`. Migrazioni in `api/alembic/versions/`.
- **Timer lato client.** `web/src/lib/restTimer.ts` (`clockOffsetMs`, `remainingSeconds`, `unlockAudio`, `beep`, `vibrate`), `web/src/components/gym/RestTimerBar.tsx` (suona una sola volta per `rest_ends_at`, solo se ha visto il riposo in corso) con test `RestTimerBar.test.tsx`. `web/src/pages/gym/WorkoutPage.tsx:186` sblocca l'audio su `onPointerDown`.
- **Impostazioni.** `web/src/pages/SettingsPage.tsx` (oggi solo link Account e Gestione utenti) con test `SettingsPage.test.tsx`. Permessi utente via `useHasPermission` (`web/src/auth/AuthContext.tsx`), permesso `workouts` in `api/app/permissions.py`.
- **Service worker.** `web/vite.config.ts`: VitePWA `generateSW`, `registerType: "autoUpdate"`, `navigateFallbackDenylist`, `runtimeCaching` per `api-foods-cache`. Il logout svuota quella cache (`clearClientCaches` in `AuthContext.tsx`). `web/nginx.conf` serve i `.js` con `no-cache`.

Vincoli (dal brainstorm): Web Push su iOS funziona solo per PWA installate (iOS 16.4+). Il permesso notifiche si può chiedere solo dopo un tap. Ogni push ricevuto deve mostrare una notifica, altrimenti iOS revoca la subscription. La notifica usa il suono di sistema. Il Focus blocca le notifiche di YFP se l'utente non la aggiunge alle app consentite. Il web push non supera il Focus con il livello "time-sensitive". Non esiste oggi alcuna infrastruttura push. I test API con DB girano solo sul deploy remoto.

## Impatto sull'esistente

- Comportamenti che cambiano:
  - in primo piano, a fine riposo, al posto dei due bip a 880 Hz suona una campanella che si sente anche con la musica negli auricolari;
  - chi attiva il toggle riceve una notifica "Riposo finito" a ogni fine riposo, anche con l'app in primo piano (doppio avviso accettato);
  - Impostazioni mostra la nuova sezione "Avviso fine riposo";
  - il logout disattiva l'avviso sul dispositivo da cui si esce.
- Comportamenti da preservare:
  - countdown visivo `m:ss` e barra di avanzamento calcolati da `rest_ends_at` con correzione dell'offset;
  - pulsanti `-15s`, `+15s`, `Salta` e timer manuale, con le stesse risposte dell'API;
  - timer corretto dopo sleep dello schermo e reload della pagina;
  - la barra si nasconde a zero e l'avviso in-app scatta una sola volta per `rest_ends_at`, solo se il riposo era stato visto in corso;
  - header della sessione live agganciato al visual viewport (fix `timer-riposo-scompare-scroll`);
  - spunta serie, fine e annullamento allenamento invariati;
  - service worker: precache della shell, aggiornamento automatico, `navigateFallbackDenylist` per `/api/`, `/mcp`, OAuth e `/.well-known/`, cache `api-foods-cache` svuotata al logout;
  - per chi non attiva il toggle nessuna richiesta di permesso e nessuna notifica;
  - contenuto esistente di Impostazioni (link Account, Gestione utenti per admin, niente ingranaggio nella pagina stessa).
- Compatibilità: retrocompatibile. Gli endpoint esistenti non cambiano forma. I nuovi endpoint sono aggiunti. Senza chiavi VAPID in env l'API parte comunque e l'avviso push risulta non disponibile; la campanella in-app funziona lo stesso. Il service worker aggiornato sostituisce il precedente con il normale `autoUpdate`.
- Migrazioni: una migrazione Alembic che aggiunge la tabella delle subscription push per utente e un campo su `workouts` che registra quale `rest_ends_at` è già stato notificato. Nuove variabili d'ambiente VAPID (chiave pubblica, privata, contatto) documentate in `.env.example`. I riposi già scaduti al momento della migrazione non devono generare notifiche.

## Requisiti funzionali

- **R1**: In Impostazioni, per gli utenti con il permesso `workouts`, deve esserci un toggle "Avviso fine riposo" con un testo che spiega che per sentirlo in palestra con il Focus attivo bisogna aggiungere YFP alle app consentite del Focus.
- **R2**: Attivando il toggle, l'app deve chiedere il permesso notifiche (dopo il tap), registrare la subscription push del dispositivo sul server e mostrare il toggle attivo. Disattivandolo deve cancellare la subscription sul server e nel browser.
- **R3**: Lo stato del toggle deve riflettere il dispositivo corrente: attivo solo se il dispositivo ha una subscription registrata e il permesso è concesso.
- **R4**: Se il dispositivo non supporta il Web Push (per esempio Safari non installato in Home), se il permesso è negato o se il server non ha le chiavi VAPID, il toggle deve risultare non attivabile con un messaggio che spiega il motivo (installare l'app in Home, riabilitare il permesso nelle impostazioni di iOS, avviso non configurato sul server).
- **R5**: Il server deve memorizzare le subscription per utente, senza duplicati per endpoint. Registrare un endpoint già esistente lo aggiorna e lo assegna all'utente corrente. Le subscription che il push service rifiuta come scadute (404/410) devono essere rimosse.
- **R6**: Quando `rest_ends_at` di un allenamento in corso scade, il server deve inviare un Web Push a tutte le subscription dell'utente entro circa 2 secondi dalla scadenza, al più una volta per ogni valore di `rest_ends_at`.
- **R7**: Non deve partire nessun push per un riposo saltato, per un riposo spostato con ±15s (vale solo il nuovo `rest_ends_at`), per un allenamento finito o annullato prima della scadenza, né per riposi scaduti da più di 60 secondi (per esempio dopo un fermo del server o al primo avvio dopo la migrazione).
- **R8**: Il service worker deve mostrare una notifica per ogni push ricevuto, anche con l'app in primo piano. Il testo è "Riposo finito · <nome allenamento>" (per esempio "Riposo finito · Push A"), oppure solo "Riposo finito" se l'allenamento non ha nome. Toccando la notifica si apre la PWA o la si porta in primo piano sulla sessione live `/gym/workout`.
- **R9**: In primo piano, a fine riposo, la pagina deve suonare un campione di campanella che si sente negli auricolari insieme alla musica senza interromperla, una sola volta per `rest_ends_at`, con le stesse condizioni del bip di oggi (riposo visto in corso, non saltato). Suona solo se la pagina osserva la scadenza entro 5 secondi: tornando in primo piano più tardi (avviso già dato dalla notifica) la campanella non suona.
- **R10**: L'audio in-app deve restare pronto dopo spegnimento dello schermo o cambio app: al ritorno in primo piano la pagina riprende il contesto audio senza bisogno di un nuovo tap, quando il sistema lo consente.
- **R11**: Al logout l'app deve cancellare la subscription del dispositivo sul server, così un altro utente che entra dallo stesso telefono non riceve gli avvisi del precedente.
- **R12**: Gli endpoint push devono richiedere l'utente autenticato e rispettare il middleware CSRF. Ogni utente vede e cancella solo le proprie subscription.

## Requisiti non funzionali

- Affidabilità: nessun push duplicato per lo stesso `rest_ends_at`, anche se in futuro girano più processi API (claim atomico sul DB, ADR 0001). Un errore di invio o del push service non deve fermare il loop né rallentare le richieste HTTP.
- Prestazioni: il controllo periodico dei riposi scaduti deve costare una query leggera al secondo, indicizzata, anche senza allenamenti in corso.
- Sicurezza: la chiave privata VAPID solo in env, mai nel repo o nelle risposte. Il payload della notifica non contiene dati personali oltre al testo "Riposo finito" e al nome dell'allenamento.
- Avvio: senza chiavi VAPID il loop di invio non parte e l'API resta funzionante.
- Compatibilità: iPhone con iOS 26, PWA installata in Home. Su altri browser funziona se supportano Web Push, senza test dedicati.

## Criteri di accettazione

Verificabili con test automatici (`cd web && npm test` in locale; pytest sul deploy remoto):

- **C1** (R1, R4): Dato un utente con permesso `workouts`, quando apre Impostazioni, allora vede il toggle "Avviso fine riposo" e il testo sul Focus. Dato un utente senza permesso `workouts`, il toggle non c'è. Con `PushManager` assente il toggle è disabilitato e mostra l'indicazione di installare l'app in Home.
- **C2** (R2, R3): Dato il toggle spento e il permesso concesso (API del browser simulate), quando l'utente lo attiva, allora l'app invia la subscription al server e il toggle risulta attivo; quando lo disattiva, allora chiama la cancellazione sul server e nel browser e il toggle risulta spento. Con permesso negato non viene inviato nulla e compare il messaggio di R4.
- **C3** (R5, R12): Eseguendo pytest sul deploy remoto, i test del router push verificano che: registrare due volte lo stesso endpoint produce una sola riga; un utente non può cancellare la subscription di un altro; una scrittura senza `X-Requested-With` riceve 403; una subscription che riceve 410 viene rimossa.
- **C4** (R6): Eseguendo pytest sul deploy remoto, dato un allenamento con `rest_ends_at` scaduto e non notificato, quando gira un'iterazione dello scheduler (con invio simulato), allora parte un push per ogni subscription dell'utente; una seconda iterazione non ne invia altri.
- **C5** (R7): Eseguendo pytest sul deploy remoto, quando il riposo viene saltato, spostato con `delta_s`, oppure l'allenamento viene finito o annullato prima della scadenza, allora nessuna iterazione invia un push per il vecchio `rest_ends_at`; dopo un `delta_s` parte un solo push alla nuova scadenza. Un riposo scaduto da più di 60 secondi non genera push.
- **C6** (R6, affidabilità): Eseguendo pytest sul deploy remoto, due claim concorrenti sullo stesso riposo scaduto producono un solo invio.
- **C7** (R9): Dato `RestTimerBar` con un riposo in corso, quando il tempo arriva a zero, allora la campanella viene richiesta una sola volta e la barra sparisce; se il riposo non era stato visto in corso, o `rest_ends_at` è null, non suona. Dato un riposo in corso, quando la pagina osserva lo zero per la prima volta più di 5 secondi dopo `rest_ends_at` (per esempio al ritorno dal background), allora la campanella non suona e la barra sparisce.
- **C8** (R11): Dato un dispositivo con subscription attiva, quando l'utente fa logout, allora l'app chiama la cancellazione della subscription prima di svuotare le cache.
- **C9** (build): Eseguendo `cd web && npm run build`, la build termina senza errori e il service worker generato include la gestione degli eventi `push` e `notificationclick`.

Verificabili solo sul dispositivo (iPhone, iOS 26, PWA installata in Home, auricolari con musica, deploy remoto con chiavi VAPID):

- **C10** (R6, R8): Dato l'avviso attivo e un riposo di 30 s, quando l'utente blocca il telefono, allora alla scadenza arriva la notifica "Riposo finito · <nome allenamento>" con il suono di sistema, entro circa 2 secondi. Stesso risultato passando a Spotify o a una chat durante il riposo.
- **C11** (R8): Toccando la notifica si apre YFP sulla sessione live in corso.
- **C12** (R1): Con il Focus palestra attivo e YFP tra le app consentite, la notifica arriva e suona. Senza YFP tra le consentite, la notifica è silenziata come previsto dal testo in Impostazioni.
- **C13** (R9, R10): Con YFP in primo piano e musica negli auricolari, a fine riposo la campanella si sente sopra la musica e la musica non si ferma. Stesso risultato dopo aver spento e riacceso lo schermo durante il riposo.
- **C14** (R7): Premendo `Salta` o `-15s` fino a chiudere il riposo, non arriva nessuna notifica. Dopo `+15s` la notifica arriva alla nuova scadenza, una sola volta.

Comportamenti da preservare:

- **C15** (preservare): Dato un riposo in corso, quando l'utente preme `-15s`, `+15s` o `Salta` o avvia il timer manuale, allora countdown, barra di avanzamento e risposte dell'API sono identici a prima (test esistenti di `RestTimerBar.test.tsx`, `restTimer.test.ts` e `api/tests/test_workouts_live.py` invariati e verdi).
- **C16** (preservare): Dato un riposo in corso, quando lo schermo si spegne o la pagina viene ricaricata, allora al ritorno il countdown mostra il tempo corretto calcolato da `rest_ends_at` e `server_now`.
- **C17** (preservare): Dato un allenamento in corso con visual viewport spostato, allora l'header con la barra del riposo resta agganciato alla parte visibile (test esistenti del fix `timer-riposo-scompare-scroll` verdi).
- **C18** (preservare): Dato un utente che non attiva il toggle, quando usa l'app e completa riposi, allora non riceve richieste di permesso notifiche né notifiche.
- **C19** (preservare): Dopo l'aggiornamento del service worker, la PWA si apre offline dalla shell in precache, le navigazioni verso `/api/`, `/mcp`, `/authorize`, `/token`, `/register`, `/revoke`, `/.well-known/` vanno in rete, e al logout la cache `api-foods-cache` viene svuotata come prima.
- **C20** (preservare): Impostazioni mostra ancora il link Account, "Gestione utenti" solo agli admin e nessun ingranaggio nella pagina stessa (test esistenti di `SettingsPage.test.tsx` verdi).

Non regressione:

- **C21** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano, anche quelli esistenti.
- **C22** (non regressione): Eseguendo la suite pytest dell'API sul deploy remoto (dopo push del branch e `git pull` sul server), tutti i test passano, anche quelli esistenti, e la migrazione si applica senza errori su un DB con allenamenti in corso e finiti.

## Fuori scope

- Dynamic Island e Live Activities (richiedono un'app nativa).
- Suono custom per la notifica in background.
- Wrapper nativo (Capacitor o simili).
- Ottimizzazioni per Android (pattern di vibrazione e simili); funziona se il browser lo supporta, senza test.
- Notifiche push per eventi diversi dalla fine del riposo.
- Prompt o banner di permesso nella pagina allenamento: l'unico punto di attivazione è il toggle in Impostazioni.
- Eliminare il doppio avviso in primo piano (notifica più campanella): accettato per ora.
- Superare il Focus senza intervento dell'utente.

## Rischi

- Causa del bip muto in primo piano non confermata (sessione audio, contesto sospeso, contesto mai sbloccato). Mitigazione: C13 sul dispositivo prima di chiudere la feature; se la campanella resta muta si riapre la diagnosi senza bloccare la parte push, che è indipendente.
- Il Focus silenzia la notifica se l'utente non aggiunge YFP. Mitigazione: testo esplicito in Impostazioni (R1) e C12.
- iOS revoca la subscription se un push non mostra una notifica. Mitigazione: R8 impone una notifica per ogni push, anche in primo piano.
- Subscription vecchie o revocate da iOS lasciano il toggle in uno stato sbagliato. Mitigazione: R3 legge lo stato dal dispositivo e R5 rimuove le subscription 404/410.
- Latenza APNs più tick del loop (fino a circa 2 s). Accettato nel brainstorm.
- Il loop gira nel processo uvicorn: un'eccezione non gestita lo fermerebbe in silenzio. Mitigazione: requisito di affidabilità e log degli errori di invio.
- I test con DB non girano in locale. Mitigazione: C22 sul deploy remoto; la logica di claim va coperta da test (C4-C6).
