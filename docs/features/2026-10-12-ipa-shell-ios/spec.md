# Spec: IPA shell iOS

- Data: 2026-10-12
- Tipo: feature
- Stato: completato
- Brainstorm: [brainstorm.md](../2026-10-12-app-ios-offline/brainstorm.md)

## Obiettivo

Produrre da CI, al push di un tag `v*`, un'IPA non firmata installabile con SideStore. L'IPA contiene la UI esistente nel bundle e parla con l'API pubblica via HTTPS usando un token Bearer. È la feature 1 dell'approccio A del brainstorm e serve a validare la pipeline fino al telefono. Al posto del Web Push l'IPA usa notifiche locali di fine riposo, e aggiunge haptics nativi. La palestra offline resta per la feature 3.

## Contesto tecnico

Decisioni di riferimento:

- [ADR 0003](../../decisions/0003-auth-bearer-client-nativo.md): sessione da cookie oppure da `Authorization: Bearer`, login invariato, CORS solo per l'origin dell'app.
- [ADR 0001](../../decisions/0001-web-push-scheduler-in-process.md) e la spec [campanella-fine-riposo](../2026-09-30-campanella-fine-riposo/spec.md): Web Push per la PWA. Quella spec metteva "Wrapper nativo (Capacitor o simili)" fuori scope. Questa feature lo introduce solo per l'IPA, e il Web Push della PWA resta com'è.
- [ADR 0004](../../decisions/0004-palestra-offline-sync-a-blocco.md): non si applica qui (feature 3). Tuttavia la scelta di mettere la UI nel bundle viene già da quella direzione.

Parti coinvolte:

- **Client HTTP.** `web/src/api/client.ts` usa `BASE_PATH = "/api"` fisso, `credentials: "include"` e header `X-Requested-With: yfp`. Tutte le chiamate API passano da qui. L'unica `fetch` diretta è `/sounds/rest-bell.wav` in `web/src/lib/restTimer.ts`, che è un asset del bundle e non dell'API. I test `web/src/api/weights.test.tsx` e `web/src/api/savedWeeks.test.tsx` verificano l'URL `/api/...` e l'oggetto `init` esatti.
- **Login web.** `web/src/pages/LoginPage.tsx` gestisce i passaggi credenziali, TOTP, setup e recovery code con le funzioni di `web/src/api/auth.ts`. La gestione dei 401 sta in `web/src/App.tsx` (QueryCache/MutationCache) e in `web/src/auth/AuthGuard.tsx`. Senza rete, `AuthGuard` mostra "Impossibile contattare il server". Il logout è `useLogout` in `web/src/auth/AuthContext.tsx`: chiama `unsubscribeDeviceOnLogout`, poi `logout()`, poi svuota le cache.
- **Auth server.** `api/app/auth/deps.py`: `get_current_user` legge solo il cookie `session`. `api/app/auth/sessions.py`: `create_session` restituisce un token opaco, salvato come hash in `UserSession`, con scadenza scorrevole di `session_max_age_days`. `resolve_session`, `revoke_session` e `revoke_all` restano invariati. Il challenge di login viaggia in un cookie `login_challenge` (`SameSite=Strict`, path `/api/auth`). Un client cross-origin non lo riceve né lo rimanda, per via di ITP. `api/app/routers/auth.py`: `login`, `totp`, `setup/start`, `setup/complete`, `logout` (revoca la sessione corrente), `sessions` e `DELETE sessions/{id}`.
- **App FastAPI.** `api/app/main.py`: oggi non c'è nessun middleware CORS. Il middleware `csrf_protection` richiede `X-Requested-With: yfp` sulle scritture sotto `/api/` ed esclude `OPTIONS`. In fondo c'è un mount MCP su `/`. Configurazione in `api/app/config.py` (`public_base_url`, `cookie_secure`, VAPID).
- **PWA.** In `web/vite.config.ts`, `VitePWA` usa `registerType: "autoUpdate"` senza registrazione esplicita nel codice (`web/src/main.tsx`). La registrazione la inietta il plugin in fase di build. Il service worker importa `push-sw.js` (`web/public/push-sw.js`) e ha `runtimeCaching` per `api-foods-cache`. `web/Dockerfile` esegue `npm run build` (`tsc -b && vite build`) e nginx (`web/nginx.conf`) serve la SPA e fa da proxy per `/api/` sullo stesso origin.
- **Web Push.** `web/src/lib/push.ts` (`pushAvailability`, `enableRestAlerts`, `unsubscribeDeviceOnLogout`) e `web/src/components/RestAlertSetting.tsx` (toggle "Avviso fine riposo" in Impostazioni). Lato server ci sono `api/app/routers/push.py` e `api/app/services/rest_notifier.py`. In una WKWebView `pushAvailability()` restituisce `"unsupported"`, e oggi il toggle mostrerebbe "Installa YFP nella schermata Home", un messaggio sbagliato dentro l'IPA.
- **Timer di riposo.** `web/src/lib/restTimer.ts` (offset dell'orologio da `server_now`, campanella WebAudio, `vibrate()` tramite `navigator.vibrate`, che su iOS non esiste). `web/src/components/gym/RestTimerBar.tsx` suona una sola volta per `rest_ends_at`, entro 5 s. `web/src/pages/gym/WorkoutPage.tsx` gestisce avvio manuale, ±15 s, Salta e fine allenamento. Il riposo parte lato server al completamento di una serie (`web/src/components/gym/SetRow.tsx`).
- **CI.** `.github/workflows/ios-release.yml` (runner `macos-15`, trigger su tag `v*` o `workflow_dispatch`). Fallisce se manca `web/ios/App`. Esegue `npm ci`, `npm run build`, `npx cap sync ios`, un `xcodebuild` senza firma e lo zip `Payload/`. Pubblica una release GitHub e carica l'asset sulla release Gitea `https://git.septimilleso.uk` usando il secret `GITEA_TOKEN`.

Vincoli:

- La distribuzione passa da SideStore con un account Apple gratuito, quindi niente entitlement Push.
- Gitea (`origin`) è la fonte. GitHub è solo un push mirror: nessun push diretto su GitHub.
- Non c'è un Postgres locale. Il comando `cd web && npm test` gira in locale. pytest gira solo sul deploy remoto via docker compose.
- Il bundle Capacitor serve la UI da `capacitor://localhost`, quindi le chiamate verso l'API sono cross-origin.

## Impatto sull'esistente

- Comportamenti che cambiano:
  - L'API risponde alle richieste CORS che arrivano dall'origin dell'app nativa.
  - L'API accetta anche `Authorization: Bearer`.
  - Le sessioni create dall'IPA compaiono nell'elenco sessioni di Account, revocabili come le altre.
  - Per chi usa l'IPA, il toggle "Avviso fine riposo" usa le notifiche locali invece del Web Push.
  - Nella PWA e nel browser non cambia nulla di visibile.
  - Il workflow iOS produce una build web dedicata al bundle nativo.
- Comportamenti da preservare:
  - Nella PWA e nel browser le chiamate vanno su `/api` stesso origin, con cookie `session` `HttpOnly` `SameSite=Lax`. Il login via browser non restituisce nessun token nel body.
  - Il flusso di login web (password, TOTP, setup con cambio password e recovery code, ritorno a `next`) resta uguale.
  - Il CSRF `X-Requested-With: yfp` resta obbligatorio su tutte le scritture `/api/`.
  - Logout, cambio password (che revoca le altre sessioni) e revoca di una sessione da Account restano uguali.
  - Il service worker della PWA mantiene precache della shell, `autoUpdate`, `navigateFallbackDenylist`, `api-foods-cache` svuotata al logout e handler `push`/`notificationclick`.
  - Il Web Push di fine riposo resta uguale: toggle, subscription, scheduler server, cancellazione al logout.
  - Il timer di riposo resta uguale: countdown da `rest_ends_at` con offset, -15s/+15s/Salta, campanella in primo piano una sola volta entro 5 s, `navigator.vibrate` sul web.
  - Restano invariati il flusso OAuth/MCP (`/authorize`, `/token`, `/mcp`, `/.well-known/`) e la build Docker `npm run build` della PWA.
  - I test esistenti, web e pytest, restano verdi.
- Compatibilità: retrocompatibile. Nessun endpoint cambia forma per i client esistenti. Il token nella risposta di login e il challenge senza cookie si attivano solo quando il client si dichiara nativo in modo esplicito. Senza header Bearer il comportamento di `get_current_user` resta identico. La nuova configurazione CORS ha un default che accetta solo l'origin dell'app.
- Migrazioni: nessuna migrazione DB, perché il token Bearer è lo stesso valore di sessione già in `UserSession`. La configurazione cresce in tre punti:
  - una variabile d'ambiente API per l'allowlist CORS, da documentare in `.env.example`;
  - la variabile di build `VITE_API_BASE_URL` per la build nativa;
  - una variabile (o secret) GitHub Actions con l'URL pubblico dell'API, oltre al secret `GITEA_TOKEN` già richiesto dal workflow.

## Requisiti funzionali

- **R1**: In `web/` deve esserci un progetto Capacitor con la piattaforma iOS generata e committata in `web/ios/` (cartella `web/ios/App` attesa dal workflow). L'app carica la UI dal bundle, senza `server.url`.
- **R2**: La build per il bundle nativo deve chiamare l'API su un URL assoluto HTTPS fissato a build time (`VITE_API_BASE_URL`, valore di produzione `https://pal.septimilleso.uk/api`, lo stesso dominio di `PUBLIC_BASE_URL`; in CI viene da una *variable* GitHub Actions `API_BASE_URL`, non da un secret). La build PWA (`npm run build`, Docker) deve continuare a usare `/api` stesso origin. Se `VITE_API_BASE_URL` manca, la build nativa deve fallire.
- **R3**: La build per il bundle nativo non deve registrare nessun service worker e non deve includere il codice di registrazione PWA. La build PWA resta invariata.
- **R4**: Il server deve autenticare una richiesta con un token di sessione valido preso dal cookie `session` oppure dall'header `Authorization: Bearer <token>`. Token assente, scaduto, revocato o con `auth_version` superata deve dare 401, come oggi.
- **R5**: Il login dall'IPA deve avere gli stessi passaggi del web: password, poi TOTP o recovery code, oppure il setup TOTP con cambio password obbligatorio e recovery code. Il client nativo si dichiara in modo esplicito. Per lui il challenge tra un passaggio e l'altro non dipende da cookie, e all'ultimo passaggio riceve il token di sessione nella risposta. Un client che non si dichiara nativo riceve solo il cookie, come oggi.
- **R6**: L'IPA deve conservare il token sul dispositivo con Capacitor Preferences (non Keychain) e inviarlo come `Authorization: Bearer` su ogni chiamata API, sempre con `X-Requested-With: yfp`. Il token deve sopravvivere alla chiusura e riapertura dell'app. Va rimosso dal dispositivo al logout, anche se il server non risponde, e alla prima risposta 401.
- **R7**: Il logout dall'IPA deve revocare la sessione sul server, così il token non è più valido. Le sessioni dell'IPA devono comparire in Account › sessioni, e revocarne una deve far tornare l'IPA al login alla richiesta successiva.
- **R8**: L'API deve rispondere al CORS solo per un'allowlist di origin configurabile, con default `capacitor://localhost`. Deve consentire i metodi usati dal client e gli header `Authorization`, `Content-Type` e `X-Requested-With`. Non deve emettere header CORS per origin non in lista e non deve abilitare credenziali cookie cross-origin. Il controllo CSRF `X-Requested-With` resta valido anche per le richieste Bearer.
- **R9**: Nell'IPA, con l'avviso attivo, l'app deve programmare una notifica locale per ogni riposo di cui conosce un `rest_ends_at` futuro. Il riposo può partire dal completamento di una serie, dal timer manuale o da ±15 s. L'istante sul dispositivo è `rest_ends_at` corretto con l'offset da `server_now`. Le regole:
  - Per ogni allenamento è pendente al massimo una notifica, sostituita a ogni nuovo `rest_ends_at`.
  - La notifica va cancellata quando il riposo viene saltato, quando `rest_ends_at` diventa nullo o passato, quando l'allenamento viene finito o annullato e al logout.
  - Il testo è lo stesso del Web Push: "Riposo finito · <nome allenamento>", oppure "Riposo finito" se l'allenamento non ha nome.
  - Toccare la notifica apre l'app sulla sessione live `/gym/workout`.
  - Il suono è la campanella esistente (`rest-bell.wav`) se iOS accetta il file come suono di notifica. Altrimenti si usa il suono di sistema.
- **R10**: Nell'IPA, la sezione "Avviso fine riposo" di Impostazioni deve gestire le notifiche locali:
  - attivarla chiede il permesso notifiche di iOS;
  - con permesso negato mostra il messaggio esistente per riabilitarlo da Impostazioni iOS;
  - disattivarla cancella le notifiche pendenti;
  - non deve mostrare il messaggio "Installa YFP nella schermata Home".
  Senza attivazione l'app non chiede permessi e non programma notifiche.
- **R11**: L'IPA non deve usare il Web Push: nessuna chiamata a `/api/push/*` e nessuna subscription. Nella PWA la logica push esistente (`web/src/lib/push.ts`, `RestAlertSetting`, scheduler server) resta invariata.
- **R12**: Nell'IPA l'app deve emettere un feedback aptico nativo in due casi: al completamento di una serie, e a fine riposo quando la pagina osserva lo zero in primo piano, insieme alla campanella e con la stessa regola dei 5 s. Sul web la funzione aptica non fa nulla e resta il `navigator.vibrate` di oggi.
- **R13**: Il workflow `.github/workflows/ios-release.yml` deve costruire l'IPA dal progetto Capacitor, usando la build nativa di R2 e R3 con l'URL dell'API preso dalla configurazione di GitHub Actions. Al push di un tag `v*` (o con `workflow_dispatch`) deve:
  - produrre `yourfitnesspal-<tag>.ipa` non firmata con `Payload/App.app`;
  - pubblicarla nella release GitHub del tag;
  - caricarla come asset della release Gitea dello stesso tag.
  La versione mostrata dall'app (`CFBundleShortVersionString`) deve corrispondere al tag senza la `v`.
- **R14**: L'IPA prodotta deve essere installabile con SideStore usando un account Apple gratuito. Si deve aprire sulla schermata di login e funzionare contro l'API pubblica.
- **R15**: Un tag creato e pushato su Gitea deve arrivare a GitHub tramite il push mirror e far partire il workflow, senza push diretti su GitHub. La procedura di rilascio va documentata nel `README.md` della root: tag, prerequisiti (mirror con tag, Actions abilitate, `GITEA_TOKEN`, URL API), installazione e aggiornamento con SideStore.

## Requisiti non funzionali

- Sicurezza:
  - Il token Bearer è leggibile da JS, quindi non va mai scritto nei log, negli URL o in storage condivisi con il web (ADR 0003).
  - Il CORS è ristretto all'allowlist (R8).
  - Rate limit e lockout del login valgono anche per il flusso nativo.
  - Il challenge senza cookie mantiene la stessa firma e la stessa scadenza (`login_challenge_max_age_seconds`) del cookie.
- Compatibilità: iPhone con iOS 26 e SideStore. Il runner di CI è `macos-15` con Xcode di default. Capacitor è alla versione stabile corrente compatibile con quell'Xcode.
- Isolamento: il codice nativo (Capacitor, plugin Local Notifications e Haptics) si attiva solo su piattaforma nativa. Sul web e in jsdom (`npm test`) i plugin non vengono chiamati, oppure degradano a no-op.
- Offline (limite accettato in questa feature): senza rete l'IPA si apre dal bundle e mostra la schermata esistente "Impossibile contattare il server" con "Riprova". Il funzionamento offline della palestra arriva con la feature 3.

## Criteri di accettazione

Verificabili con test automatici in locale (`cd web && npm test`):

- **C1** (R2): Dato il client API configurato con un URL base assoluto, quando parte una chiamata, allora `fetch` riceve `<URL base>/<path>`. Senza configurazione riceve `/api/<path>`, con lo stesso `init` di oggi.
- **C2** (R6): Dato il client in modalità nativa con un token salvato, quando parte una chiamata, allora gli header contengono `Authorization: Bearer <token>` e `X-Requested-With: yfp`. Dato un 401, il token viene rimosso. In modalità web nessun header `Authorization` viene aggiunto.
- **C3** (R5, R6): Dato il login in modalità nativa, quando l'utente completa password e TOTP (oppure il setup), allora il client salva il token restituito e nessun passaggio dipende da cookie. Quando fa logout, il token viene rimosso anche se la chiamata al server fallisce.
- **C4** (R9): Dati i plugin nativi simulati e un allenamento con `rest_ends_at` futuro, l'app programma una sola notifica all'istante corretto per l'offset, con titolo "Riposo finito · <nome>". Dopo +15 s la notifica viene sostituita da una nuova alla nuova scadenza. Dopo Salta, fine o annullamento dell'allenamento, oppure dopo il logout, la notifica viene cancellata.
- **C5** (R10, R11): Dato `RestAlertSetting` in modalità nativa, quando l'utente attiva il toggle, allora viene chiesto il permesso delle notifiche locali e non parte nessuna chiamata a `/api/push/*`. Con permesso negato compare il messaggio di riabilitazione. Il messaggio "Installa YFP nella schermata Home" non compare.
- **C6** (R12): Dato un riposo in corso in modalità nativa, quando il timer osservato in primo piano arriva a zero, allora la funzione aptica viene chiamata una volta insieme alla campanella. Quando si completa una serie viene chiamata una volta. In modalità web la funzione aptica non chiama nessun plugin.

Verificabili con comandi:

- **C7** (R2, R3): Eseguendo `cd web && npm run build`, la build termina senza errori e `dist/` contiene il service worker e la registrazione PWA come oggi. Eseguendo la build nativa definita nel piano con `VITE_API_BASE_URL` impostato, l'output non contiene registrazione del service worker e contiene l'URL assoluto. Senza `VITE_API_BASE_URL` la build nativa fallisce con un messaggio esplicito.

Verificabili con pytest sul deploy remoto (push del branch su Gitea, `git pull` sul server, pytest via docker compose):

- **C8** (R4): Dato un utente con sessione valida, una richiesta a un endpoint protetto con `Authorization: Bearer <token>` e senza cookie riceve 200. Con un token revocato, scaduto o casuale riceve 401.
- **C9** (R5): Dato un client che si dichiara nativo, quando esegue login e TOTP senza inviare cookie, allora l'ultima risposta contiene un token che funziona come Bearer. Lo stesso vale per il setup TOTP. Un challenge alterato o scaduto riceve 401 "challenge scaduto". Un client che non si dichiara nativo non riceve nessun token nel body.
- **C10** (R7): Dato un token Bearer, quando il client chiama `POST /api/auth/logout` con quel token, allora la richiesta successiva con lo stesso token riceve 401. Quando la sessione viene revocata da `DELETE /api/auth/sessions/{id}`, il token riceve 401. `GET /api/auth/sessions` elenca la sessione Bearer con `current: true` se interrogato con quel token.
- **C11** (R8): Una preflight `OPTIONS` con `Origin: capacitor://localhost` e `Access-Control-Request-Headers: authorization, content-type, x-requested-with` riceve gli header CORS che consentono quell'origin e quegli header. Con `Origin: https://evil.example` non riceve `Access-Control-Allow-Origin`. Una `POST` Bearer senza `X-Requested-With` riceve 403 `csrf`.

Verificabili in CI e nei mirror:

- **C12** (R15): Dato un tag `v*` nuovo creato e pushato solo su Gitea, entro l'intervallo del push mirror il tag compare su GitHub e parte il run "iOS release".
- **C13** (R13): Al termine del run di C12, la release GitHub del tag e la release Gitea dello stesso tag contengono `yourfitnesspal-<tag>.ipa`. Il file contiene `Payload/App.app` con `CFBundleShortVersionString` uguale al tag senza `v`.

Verificabili solo sul dispositivo (iPhone, iOS 26, SideStore con account gratuito, deploy remoto aggiornato):

- **C14** (R14): Data l'IPA di C13, quando la si installa con SideStore, allora l'app si apre sulla schermata di login con la grafica esistente.
- **C15** (R5, R6, R7): Con login password più TOTP, l'app mostra il diario. Chiusa dal multitasking e riaperta, resta autenticata. In Account › sessioni compare la sessione dell'IPA. Revocandola dal browser, l'IPA torna al login alla prima azione. Dopo il logout dall'IPA serve un nuovo login.
- **C16** (R9, R10): Con l'avviso attivato in Impostazioni e il permesso concesso, durante un allenamento si completa una serie con riposo di 30 s e si blocca il telefono. Alla scadenza arriva la notifica "Riposo finito · <nome>" con la campanella, oppure con il suono di sistema se iOS non accetta il file. Lo stesso accade passando a un'altra app. Toccandola si apre la sessione live.
- **C17** (R9): Premendo Salta, oppure finendo o annullando l'allenamento durante un riposo, non arriva nessuna notifica. Dopo +15 s arriva una sola notifica, alla nuova scadenza.
- **C18** (R12): Completando una serie si sente un feedback aptico. Con l'app in primo piano a fine riposo si sentono campanella e feedback aptico.
- **C19** (R1, NFR offline): In modalità aereo l'IPA si apre e mostra "Impossibile contattare il server" con "Riprova". Al ritorno della rete, Riprova carica i dati.

Comportamenti da preservare:

- **C20** (preservare): Dato un browser o la PWA sul dominio pubblico, quando l'utente fa login, allora riceve il cookie `session` `HttpOnly` `SameSite=Lax`, nessun token nel body, e le chiamate vanno su `/api` stesso origin. I test esistenti `web/src/api/weights.test.tsx`, `web/src/api/savedWeeks.test.tsx`, `web/src/pages/LoginPage.test.tsx` e `api/tests/test_auth.py` passano senza modifiche.
- **C21** (preservare): Dato un utente della PWA con l'avviso attivo, quando un riposo scade, allora arriva il Web Push come prima. Al logout la subscription viene cancellata. I test esistenti `web/src/lib/push.test.ts`, `web/src/components/RestAlertSetting.test.tsx`, `web/src/sw/pushSw.test.ts` e `api/tests/test_push_router.py` e `api/tests/test_rest_notifier*.py` passano senza modifiche.
- **C22** (preservare): Dato un riposo in corso nella PWA, quando l'utente usa -15s, +15s, Salta o il timer manuale, allora countdown, campanella (una volta, entro 5 s) e `navigator.vibrate` si comportano come prima. I test esistenti `RestTimerBar.test.tsx` e `restTimer.test.ts` restano verdi.
- **C23** (preservare): Dopo il deploy, la PWA si aggiorna con `autoUpdate`, si apre offline dalla shell in precache e lascia andare in rete le navigazioni verso `/api/`, `/mcp`, `/authorize`, `/token`, `/register`, `/revoke` e `/.well-known/`. Il collegamento di un client MCP via OAuth funziona come prima (`api/tests/test_oauth_router.py` e `api/tests/test_mcp_http.py` verdi).
- **C24** (preservare): Dato un utente con cookie, quando cambia password, allora le altre sessioni vengono revocate, comprese quelle Bearer dell'IPA, e la sessione corrente resta valida.

Non regressione:

- **C25** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano, anche quelli esistenti.
- **C26** (non regressione): Eseguendo la suite pytest dell'API sul deploy remoto via docker compose, tutti i test passano, anche quelli esistenti.

## Fuori scope

- Live Activity e Dynamic Island (feature 2).
- Palestra offline, cache locale e sync (feature 3, ADR 0004).
- HealthKit (feature 4).
- APNs e push remoti verso l'IPA.
- App Store, TestFlight, firma e notarizzazione in CI.
- Source JSON di SideStore per gli aggiornamenti automatici: gli aggiornamenti si fanno installando a mano l'IPA dalla release.
- Conservazione del token nel Keychain.
- CSP e hardening della WebView oltre a quanto richiesto da R8.
- Build e distribuzione Android.

## Rischi

- **Mirror e tag.** Il push mirror Gitea potrebbe non inoltrare i tag, oppure inoltrarli in un modo che non genera l'evento `push` su GitHub. GitHub non crea eventi per i tag quando ne arrivano più di tre in un solo push. Mitigazione: C12 su un tag singolo, `workflow_dispatch` come ripiego documentato e un tag alla volta.
- **CI e progetto Capacitor.** `xcodebuild` senza firma potrebbe fallire con il progetto generato (dipendenze CocoaPods o SPM, versione di Xcode sul runner). Mitigazione: primo tag di prova (`v0.0.1`) per validare la pipeline prima delle altre parti.
- **SideStore.** SideStore potrebbe rifiutare l'IPA (bundle id, Info.plist, architettura) o rifirmarla male. Le app scadono dopo 7 giorni e il numero di App ID è limitato. Mitigazione: C14 presto, refresh automatico di SideStore, nessuna extension in questa feature.
- **Cloudflare.** Cloudflare davanti al dominio potrebbe bloccare o cambiare le preflight CORS (bot protection, Access). Mitigazione: C11 contro il deploy reale e verifica C15 sul telefono.
- **Esposizione del token.** Il token Bearer è leggibile da JS e un XSS lo esporrebbe. Mitigazione: token non loggato, sessione revocabile da Account, dipendenze tenute pulite (ADR 0003).
- **Suono della notifica.** iOS potrebbe non accettare `rest-bell.wav` come suono di notifica (formato o durata). Mitigazione: ripiego sul suono di sistema (R9). Si verifica con C16.
- **Doppio avviso in primo piano.** Con l'app in primo piano possono arrivare insieme notifica locale e campanella. Il doppio avviso è già accettato nella spec della campanella.

## Domande aperte

Nessuna.
