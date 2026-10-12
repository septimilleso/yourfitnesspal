# Piano: IPA shell iOS

- Data: 2026-10-12
- Stato: completato
- Spec: [spec.md](spec.md)
- Tipo: feature
- Branch: feature/ipa-shell-ios

## Approccio

Il backend riusa le sessioni di `api/app/auth/sessions.py` così come sono. Le modifiche sono tre:

- `get_current_user` (`api/app/auth/deps.py`) usa il cookie `session` se c'è, altrimenti l'header `Authorization: Bearer`.
- Il login riconosce il client nativo dall'header `X-YFP-Client: native`. A quel client restituisce il challenge firmato nel body. Il client lo rimanda nell'header `X-YFP-Challenge` e alla fine riceve `token` nel body.
- Viene aggiunto un `CORSMiddleware` con allowlist da `settings`. È il middleware più esterno e lavora senza credenziali.

Il frontend ha una sola codebase. Il modulo `web/src/native/platform.ts` (`isNative()` basato su `Capacitor.isNativePlatform()`) separa i due rami. Il ramo nativo comprende sessione (Preferences), notifiche locali, haptics e toggle in Impostazioni. Il ramo web resta il codice di oggi. `web/src/api/client.ts` prende `VITE_API_BASE_URL` (default `/api`) e, solo in nativo, usa `credentials: "omit"` e manda il Bearer.

La build nativa è `vite build --mode native`: senza `VitePWA` e con `VITE_API_BASE_URL` obbligatorio. Il progetto iOS è Capacitor con Swift Package Manager, così non serve CocoaPods su Windows. Il workflow esistente cambia solo nel comando di build, nella versione dal tag e nei controlli.

Le notifiche locali seguono la cache React Query di `gymKeys.active` (`web/src/api/gym.ts`). Un componente montato in `web/src/App.tsx` osserva `rest_ends_at` e programma o cancella una sola notifica con id fisso. Così coprono senza agganci per singola azione:

- serie completata;
- ±15 s;
- Salta;
- fine e annullamento.

Procedura di verifica remota (la chiamo "procedura R" nei task): è il pattern del piano [massimo-esercizio-allenamento](../2026-10-07-massimo-esercizio-allenamento/plan.md). I passi sono:

1. In locale, `git push origin feature/ipa-shell-ios`, solo verso Gitea e mai verso GitHub.
2. Sul server, l'utente esegue `git fetch origin && git checkout feature/ipa-shell-ios && git pull`, poi `docker compose build api && docker compose up -d api`.
3. I test DB girano sul DB isolato `yfp_test` con migrazioni applicate: `docker compose run --rm -T -e DATABASE_URL=<url yfp_test> -v "$PWD/api:/app" api sh -c "pip install -q pytest pytest-asyncio respx && python -m pytest <file> -q"`.

In locale si eseguono `api/.venv/Scripts/python.exe -m py_compile <file>`, `api/.venv/Scripts/ruff.exe check api/app api/tests` e i test che non usano il DB (`api/.venv/Scripts/python.exe -m pytest <file> -q`).

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Caratterizzazione web: client HTTP, API auth e build PWA

- Copre: C20, C7 (baseline PWA), C25
- Rischio: basso
- File: `web/src/api/client.test.ts` (nuovo), `web/src/api/auth.test.ts` (nuovo)
- Passi:
  1. Creare il branch `feature/ipa-shell-ios` da `main`.
  2. In `client.test.ts` (con `fetch` stub come in `web/src/api/weights.test.tsx`) fissare il comportamento attuale:
     - URL `/api<path>` e `credentials: "include"`;
     - header `X-Requested-With: yfp`, più `Content-Type: application/json` solo con body;
     - body serializzato in JSON;
     - `ApiError` con `status` e `detail` del body;
     - messaggio di ripiego senza JSON;
     - `undefined` su 204;
     - nessun header `Authorization`.
  3. In `auth.test.ts` verificare path e body di `login`, `verifyTotp`, `setupStart`, `setupComplete` e `logout` (`web/src/api/auth.ts`). Verificare anche che i valori restituiti siano quelli del server.
  4. Eseguire `cd web && npm run build` e annotare nel registro i file PWA presenti in `dist/`: oggi ci sono `sw.js`, `registerSW.js`, `manifest.webmanifest` e `workbox-*.js`, con `registerSW.js` referenziato da `dist/index.html`.
- Verifica: `cd web && npm test` con tutti i test verdi, compresi i nuovi. `cd web && npm run build` termina senza errori e `ls dist/sw.js dist/registerSW.js` li trova entrambi.

### [x] T2. Caratterizzazione backend: logout, sessioni, setup TOTP, cambio password

- Copre: C20, C24 (parte cookie), C26
- Rischio: basso
- File: `api/tests/test_auth_sessions.py` (nuovo)
- Passi:
  1. Riusare gli helper di `api/tests/test_auth.py` (`_client`, `_make_user`, fixture `session`), copiandoli o importandoli.
  2. Scrivere test DB sul comportamento attuale con cookie:
     - la risposta di `POST /api/auth/login` ha solo le chiavi `status` e `must_change_password` (nessun `token` né `challenge`);
     - il flusso `setup/start` + `setup/complete` con utente senza TOTP (e con `must_change_password`) imposta il cookie `session` e restituisce `recovery_codes`, senza `token`;
     - `POST /api/auth/logout` rende 401 la richiesta successiva a `/api/health/protected`;
     - `GET /api/auth/sessions` segna `current: true` sulla sessione in uso;
     - `DELETE /api/auth/sessions/{id}` revoca un'altra sessione;
     - `POST /api/auth/password` revoca le altre sessioni e lascia valida la corrente.
  3. Controllo locale: `py_compile` e `ruff` sul nuovo file.
  4. Procedura R con `tests/test_auth_sessions.py tests/test_auth.py`.
- Verifica: in locale, `api/.venv/Scripts/python.exe -m py_compile api/tests/test_auth_sessions.py` e `api/.venv/Scripts/ruff.exe check api/tests/test_auth_sessions.py` senza errori. Sul remoto, i test di `test_auth_sessions.py` e `test_auth.py` sono tutti verdi sul codice non ancora modificato. Se un test fallisce, si corregge il test e non il codice.

### [x] T3. Backend: sessione da Bearer in `get_current_user`

- Copre: C8, C10, C24
- Rischio: alto
- File: `api/app/auth/deps.py` (modifica), `api/tests/test_auth_bearer.py` (nuovo)
- Passi:
  1. In `get_current_user`: se c'è il cookie `session` si usa quello come oggi. Altrimenti si legge `Authorization`, che deve avere schema `Bearer` (case-insensitive) e un token non vuoto. Header assente o malformato: 401 `unauthorized`. Il token non va scritto nei log.
  2. Test DB in `test_auth_bearer.py`:
     - Bearer valido senza cookie su `/api/health/protected`: 200;
     - token casuale: 401;
     - sessione scaduta (stesso schema di `test_expired_session_denied_on_protected_route`): 401;
     - schema `Basic`: 401;
     - `POST /api/auth/logout` con Bearer, poi stessa richiesta: 401;
     - `GET /api/auth/sessions` con Bearer: `current: true` sulla sessione del token;
     - `DELETE /api/auth/sessions/{id}` da una sessione cookie: il Bearer riceve 401;
     - cambio password da sessione cookie: il Bearer di un'altra sessione riceve 401 e il cookie corrente resta valido;
     - `POST` con Bearer senza `X-Requested-With`: 403 `csrf`.
  3. Procedura R con `tests/test_auth_bearer.py tests/test_auth.py tests/test_auth_sessions.py tests/test_oauth_router.py`.
- Verifica: in locale `py_compile` e `ruff` sui file toccati senza errori. Sul remoto i quattro file di test sono tutti verdi.

### [x] T4. Backend: challenge di login senza cookie e token nel body per il client nativo

- Copre: C9, C20
- Rischio: alto
- File: `api/app/auth/sessions.py` (modifica `read_challenge`), `api/app/routers/auth.py` (modifica `login`, `totp`, `setup_complete`), `api/tests/test_auth_native.py` (nuovo)
- Passi:
  1. `read_challenge` legge il cookie `login_challenge`. Se manca, legge l'header `X-YFP-Challenge` e lo verifica con lo stesso serializer e la stessa `max_age`.
  2. `login`: con header `X-YFP-Client: native` aggiunge al body `challenge` (il valore di `sign_challenge`). Il cookie resta impostato come oggi. Rate limit e lockout restano invariati.
  3. `totp` e `setup_complete`: con `X-YFP-Client: native` aggiungono `token` al body. Senza header, il body resta identico a oggi.
  4. Test DB in `test_auth_native.py`, con client httpx senza cookiejar (svuotare `client.cookies` dopo ogni risposta):
     - login + TOTP nativi restituiscono un `token` che funziona come Bearer;
     - lo stesso per login + `setup/start` + `setup/complete`;
     - un challenge alterato riceve 401 `challenge scaduto`;
     - un challenge scaduto (con `monkeypatch` su `settings.login_challenge_max_age_seconds = -1`) riceve 401 `challenge scaduto`;
     - senza `X-YFP-Client` nessun `token` né `challenge` nel body;
     - dopo 5 login sbagliati nativi si ottiene 429.
  5. Procedura R con `tests/test_auth_native.py tests/test_auth.py tests/test_auth_sessions.py`.
- Verifica: in locale `py_compile` e `ruff` senza errori. Sul remoto i tre file sono tutti verdi.

### [x] T5. Backend: CORS con allowlist

- Copre: C11
- Rischio: alto
- File: `api/app/config.py` (modifica), `api/app/main.py` (modifica), `.env.example` (modifica), `api/tests/test_cors.py` (nuovo), `api/tests/test_config.py` (modifica)
- Passi:
  1. `Settings.cors_allowed_origins: list[str] = ["capacitor://localhost"]`, impostabile da env `CORS_ALLOWED_ORIGINS` come lista JSON. In `.env.example` va una riga commentata con il default.
  2. In `main.py` aggiungere `CORSMiddleware` dopo i middleware `csrf_protection` e `oauth_rate_limit`, così è il più esterno e anche le risposte 403/401 portano gli header CORS. I parametri:
     - `allow_origins` dalla configurazione;
     - `allow_credentials=False`;
     - metodi `GET, POST, PUT, PATCH, DELETE`;
     - header `Authorization, Content-Type, X-Requested-With, X-YFP-Client, X-YFP-Challenge`.
  3. Test senza DB in `test_cors.py`:
     - preflight `OPTIONS /api/auth/login` con `Origin: capacitor://localhost` e i tre header di C11: 200, `Access-Control-Allow-Origin: capacitor://localhost` e gli header consentiti;
     - stessa preflight con `Origin: https://evil.example`: nessun `Access-Control-Allow-Origin`;
     - `GET /api/health` con `Origin: capacitor://localhost`: ha l'header e nessun `Access-Control-Allow-Credentials: true`;
     - `POST /api/auth/logout` con Bearer e senza `X-Requested-With`: 403 `csrf`.
  4. In `test_config.py`, test sul default di `cors_allowed_origins`.
  5. Procedura R con `tests/test_cors.py tests/test_config.py tests/test_mcp_http.py tests/test_oauth_router.py`.
- Verifica: `api/.venv/Scripts/python.exe -m pytest api/tests/test_cors.py api/tests/test_config.py -q` è verde in locale (se `test_config.py` ha test DB, lanciare solo i test senza DB con `-k`). Sul remoto i quattro file sono tutti verdi.

### [x] T6. Build nativa e progetto Capacitor iOS

- Copre: C7, C23 (build PWA invariata)
- Rischio: alto
- File: `web/package.json` e `web/package-lock.json` (modifica), `web/vite.config.ts` (modifica), `web/capacitor.config.json` (nuovo), `web/ios/` (nuovo, generato), `web/src/vite-env.d.ts` o equivalente (modifica, tipo di `VITE_API_BASE_URL` se serve)
- Passi:
  1. Scegliere la major di Capacitor compatibile con l'Xcode di default del runner `macos-15`. Controllare i requisiti nella documentazione Capacitor e nel README delle runner-images di GitHub, e annotare la scelta nel registro. Installare `@capacitor/core` e `@capacitor/ios` (dipendenze) e `@capacitor/cli` (dev), tutti della stessa major.
  2. In `vite.config.ts`, passare a `defineConfig(({ mode }) => ...)`. Con `mode === "native"`:
     - `VitePWA` non va nei plugin;
     - `loadEnv` deve trovare `VITE_API_BASE_URL`, altrimenti la build lancia `Error("VITE_API_BASE_URL è obbligatorio per la build nativa")`.
     Gli altri mode restano identici a oggi: plugin, `workbox`, `server.proxy` e `test`.
  3. In `package.json` aggiungere lo script `"build:native": "tsc -b && vite build --mode native"`. `build` resta com'è.
  4. In `capacitor.config.json` impostare `appId` (`uk.septimilleso.yourfitnesspal`), `appName` (`YourFitnessPal`) e `webDir` (`dist`), senza `server.url`.
  5. Eseguire `VITE_API_BASE_URL=https://pal.septimilleso.uk/api npm run build:native`, poi `npx cap add ios --packagemanager SPM`. Controllare che `web/ios/.gitignore` generato escluda `App/App/public`, `App/build` e le copie di config, poi committare `web/ios/`. Se la CLI rifiuta di generare il progetto su Windows, segnare il task `[!]` e fermarsi senza aggirare il problema.
  6. Rieseguire `npm run build` per ripristinare `dist/` della PWA.
- Verifica:
  - `cd web && npm run build && ls dist/sw.js dist/registerSW.js`: i file esistono come nella baseline di T1.
  - `cd web && VITE_API_BASE_URL=https://pal.septimilleso.uk/api npm run build:native && test ! -e dist/sw.js && test ! -e dist/registerSW.js && ! grep -q registerSW dist/index.html && echo OK` stampa `OK`. Il controllo che l'URL assoluto sia nel bundle arriva in T7, quando `client.ts` usa la variabile.
  - `cd web && env -u VITE_API_BASE_URL npm run build:native` fallisce con il messaggio esplicito.
  - `ls web/ios/App` mostra il progetto.
  - `cd web && npm test` è verde.

### [x] T7. Client web: URL base configurabile e sessione Bearer nativa

- Copre: C1, C2, C7 (URL assoluto nel bundle), C20
- Rischio: alto
- File: `web/src/native/platform.ts` (nuovo), `web/src/native/session.ts` (nuovo), `web/src/native/session.test.ts` (nuovo), `web/src/api/client.ts` (modifica), `web/src/api/client.native.test.ts` (nuovo), `web/package.json` (aggiunta `@capacitor/preferences`)
- Passi:
  1. `platform.ts` esporta `isNative()`, che restituisce `Capacitor.isNativePlatform()`. Nei test si mocka il modulo.
  2. `session.ts` tiene token e challenge in memoria ed espone:
     - `loadNativeSession()`, che legge il token da Preferences (chiave `yfp.session`);
     - `getToken()` e `setToken(token)`, che scrive in Preferences;
     - `clearToken()`, che rimuove la chiave;
     - `getChallenge()` e `setChallenge()`, solo in memoria.
     Sul web tutte le funzioni sono no-op.
  3. `client.ts`: il base URL è `import.meta.env.VITE_API_BASE_URL || "/api"`. In modalità nativa:
     - `credentials: "omit"`;
     - header `X-YFP-Client: native`;
     - `Authorization: Bearer <token>` se c'è un token;
     - `X-YFP-Challenge` sulle chiamate `/auth/*` se c'è un challenge;
     - su 401 con `detail === "unauthorized"` chiama `clearToken()`. Gli altri 401, come password errata o codice non valido, non toccano il token.
     In modalità web, `init` resta byte per byte quello di T1.
  4. Aggiornare `cd web && npx cap sync ios` per registrare il plugin Preferences in `web/ios`. Prima serve `build:native` con la variabile, poi `npm run build`.
- Verifica: `cd web && npm test` è verde. I test di T1, `weights.test.tsx` e `savedWeeks.test.tsx` passano senza modifiche. I nuovi test coprono:
  - URL assoluto con `vi.stubEnv("VITE_API_BASE_URL", ...)`;
  - Bearer e `X-Requested-With` in nativo;
  - rimozione del token su 401 `unauthorized` ma non su 401 `credenziali non valide`;
  - nessun `Authorization` sul web.
  `cd web && VITE_API_BASE_URL=https://pal.septimilleso.uk/api npm run build:native && grep -rq "pal.septimilleso.uk/api" dist/assets && echo OK` stampa `OK`. Dopo, `npm run build` ripristina `dist/` della PWA.

### [x] T8. Login e logout nativi

- Copre: C3, C20
- Rischio: alto
- File: `web/src/api/auth.ts` (modifica), `web/src/api/auth.native.test.ts` (nuovo), `web/src/auth/AuthContext.tsx` (modifica `useLogout`), `web/src/auth/AuthContext.native.test.tsx` (nuovo), `web/src/main.tsx` (modifica)
- Passi:
  1. In `auth.ts`:
     - `login` salva `challenge` con `setChallenge` se presente nel body;
     - `verifyTotp` e `setupComplete` salvano `token` con `setToken` e azzerano il challenge;
     - i tipi di risposta ammettono i campi opzionali.
     `LoginPage.tsx` non cambia.
  2. In `useLogout`, solo in modalità nativa:
     - `logout()` in try/catch, così un errore di rete non blocca l'uscita;
     - poi `clearToken()`;
     - la cancellazione della notifica di riposo si aggancia in T9.
     L'ordine e il comportamento web restano quelli fissati da `AuthContext.test.tsx`.
  3. `main.tsx` esegue `loadNativeSession()` e poi `render` (con `.finally`, senza top-level await). Sul web il render resta immediato.
- Verifica: `cd web && npm test` è verde. `LoginPage.test.tsx`, `AuthContext.test.tsx` e `auth.test.ts` (T1) passano senza modifiche. I nuovi test verificano:
  - in nativo, login + TOTP e login + setup salvano il token;
  - il challenge viene rimandato nella chiamata successiva;
  - il logout rimuove il token anche se `logout()` rifiuta.

### [x] T9. Notifiche locali di fine riposo

- Copre: C4
- Rischio: alto
- File: `web/src/native/restNotifications.ts` (nuovo), `web/src/native/restNotifications.test.ts` (nuovo), `web/src/native/NativeBridge.tsx` (nuovo), `web/src/native/NativeBridge.test.tsx` (nuovo), `web/src/App.tsx` (modifica), `web/src/auth/AuthContext.tsx` (modifica: cancella al logout), `web/package.json` (aggiunta `@capacitor/local-notifications` e `@capacitor/filesystem`)
- Passi:
  1. `restNotifications.ts` usa un id fisso per la notifica di riposo ed espone:
     - `getRestAlertsEnabled()` e `setRestAlertsEnabled(bool)` (Preferences, chiave `yfp.restAlerts`);
     - `syncRestNotification(workout | null)`: se l'avviso è attivo, il permesso è `granted` e `rest_ends_at` è futuro, programma con `schedule.at = Date.parse(rest_ends_at) - clockOffsetMs(server_now, Date.now())` (da `web/src/lib/restTimer.ts`). La notifica ha titolo "Riposo finito · <nome>" (o "Riposo finito" se il nome è vuoto), `sound: "rest-bell.wav"` ed `extra.url = "/gym/workout"`, e sostituisce la precedente. In tutti gli altri casi la cancella;
     - `cancelRestNotification()`.
     Le chiamate vanno serializzate in una catena di promise. Sul web tutte le funzioni sono no-op.
  2. `installNotificationSound()` è best-effort: fa `fetch("/sounds/rest-bell.wav")` e scrive il file in `Library/Sounds/rest-bell.wav` con Filesystem (`Directory.Library`, `recursive: true`). Se fallisce non succede nulla e iOS usa il suono di sistema.
  3. `NativeBridge` va montato in `App.tsx` dentro `AuthProvider`, prima di `Routes`, e non rende nulla sul web. In nativo:
     - all'avvio chiama `installNotificationSound()`;
     - si iscrive alla `QueryCache` e a ogni aggiornamento di `gymKeys.active` chiama `syncRestNotification` con il dato (null dopo fine o annullamento);
     - sul listener `localNotificationActionPerformed` naviga a `extra.url`.
  4. In `useLogout` nativo, chiamare `cancelRestNotification()` prima di `logout()`.
  5. Eseguire `npx cap sync ios` come in T7.
- Verifica: `cd web && npm test` è verde. I nuovi test, con `platform` e i plugin mockati, coprono:
  - una sola `schedule` all'istante corretto con offset non nullo e il titolo con e senza nome;
  - sostituzione dopo un nuovo `rest_ends_at` (+15 s);
  - `cancel` con `rest_ends_at` null (Salta), con `active` a null (fine o annullamento), al logout e con l'avviso disattivato;
  - in `NativeBridge`, `setQueryData(gymKeys.active, ...)` provoca la sync e il tap naviga a `/gym/workout`;
  - sul web nessun plugin viene chiamato.

### [x] T10. Toggle "Avviso fine riposo" nativo in Impostazioni

- Copre: C5, C21 (test web invariati)
- Rischio: alto
- File: `web/src/components/NativeRestAlertSetting.tsx` (nuovo), `web/src/components/NativeRestAlertSetting.test.tsx` (nuovo), `web/src/pages/SettingsPage.tsx` (modifica)
- Passi:
  1. `NativeRestAlertSetting` ha la stessa struttura visiva di `RestAlertSetting`: switch "Avviso fine riposo" e testo sul Focus. Lo stato è attivo con avviso abilitato in Preferences e permesso `granted`.
  2. Comportamento del toggle:
     - attivarlo chiama `LocalNotifications.requestPermissions()`; se il permesso è concesso imposta `setRestAlertsEnabled(true)` e richiama la sync della notifica sull'allenamento in cache;
     - con permesso negato mostra il messaggio esistente "Permesso notifiche negato: riabilitalo in Impostazioni iOS › Notifiche › YFP";
     - disattivarlo imposta `false` e chiama `cancelRestNotification()`.
     Nessuna chiamata a `/api/push/*`.
  3. `SettingsPage.tsx` rende `isNative() ? <NativeRestAlertSetting /> : <RestAlertSetting />` sotto `canUseWorkouts`. `RestAlertSetting.tsx` e `web/src/lib/push.ts` non cambiano.
- Verifica: `cd web && npm test` è verde. `RestAlertSetting.test.tsx`, `SettingsPage.test.tsx` e `push.test.ts` passano senza modifiche. I nuovi test verificano:
  - la richiesta di permesso all'attivazione;
  - nessun `fetch` verso `/api/push`;
  - il messaggio di permesso negato;
  - l'assenza di "Installa YFP nella schermata Home";
  - la cancellazione alla disattivazione.

### [x] T11. Haptics nativi su serie completata e fine riposo

- Copre: C6, C22
- Rischio: alto
- File: `web/src/native/haptics.ts` (nuovo), `web/src/native/haptics.test.ts` (nuovo), `web/src/components/gym/SetRow.tsx` (modifica `toggle`), `web/src/components/gym/RestTimerBar.tsx` (modifica), `web/src/components/gym/RestTimerBar.native.test.tsx` (nuovo), `web/package.json` (aggiunta `@capacitor/haptics`)
- Passi:
  1. `haptics.ts` espone `hapticSetComplete()` (`Haptics.impact` stile Light) e `hapticRestEnd()` (`Haptics.notification` tipo Success). Sul web sono no-op ed eventuali errori del plugin vengono ignorati.
  2. `SetRow.toggle` chiama `hapticSetComplete()` subito prima di `onComplete` (non su `onUncomplete`).
  3. `RestTimerBar` chiama `hapticRestEnd()` nello stesso ramo di `beep()` e `vibrate()`, quindi con la stessa regola dei 5 s e una sola volta per `rest_ends_at`.
  4. Eseguire `npx cap sync ios` come in T7.
- Verifica: `cd web && npm test` è verde. `RestTimerBar.test.tsx`, `restTimer.test.ts` e `SetRow.test.tsx` passano senza modifiche. I nuovi test verificano:
  - in nativo una chiamata aptica allo zero osservato in tempo e nessuna oltre i 5 s;
  - una chiamata al completamento di una serie e nessuna allo "scompletamento";
  - sul web nessuna chiamata al plugin.

### [x] T12. Workflow CI per la build nativa e la versione dal tag

- Copre: C13
- Rischio: basso
- File: `.github/workflows/ios-release.yml` (modifica)
- Passi:
  1. Aggiungere uno step iniziale che valida il tag. `TAG` deve rispettare `^v[0-9]+\.[0-9]+\.[0-9]+$`, altrimenti `::error::` ed esce, perché `CFBundleShortVersionString` accetta solo numeri. Lo step calcola anche `VERSION=${TAG#v}`.
  2. Nello step "Build web and sync Capacitor":
     - `env: VITE_API_BASE_URL: ${{ vars.API_BASE_URL }}`;
     - controllo che non sia vuota;
     - `npm run build:native` al posto di `npm run build`.
     `npx cap sync ios` resta.
  3. Stampare `xcodebuild -version`. Nell'`xcodebuild` aggiungere `MARKETING_VERSION=$VERSION CURRENT_PROJECT_VERSION=${{ github.run_number }}`. Se la major di Capacitor scelta in T6 richiede un Xcode diverso dal default, selezionarlo con `xcode-select` e annotarlo.
  4. Dopo "Package IPA", verificare con `PlistBuddy` che `CFBundleShortVersionString` di `Payload/App.app/Info.plist` sia uguale a `$VERSION`. Se non lo è, il job fallisce.
  5. Lasciare invariati gli step di release GitHub e Gitea.
- Verifica: il file YAML è valido (`npx --yes yaml-lint .github/workflows/ios-release.yml`, oppure `python -c "import yaml,sys;yaml.safe_load(open(sys.argv[1]))" .github/workflows/ios-release.yml` senza errori). La verifica reale è in T15.

### [x] T13. Documentazione: rilascio IPA, SideStore e configurazione

- Copre: C12 (procedura), C13 (prerequisiti)
- Rischio: basso
- File: `README.md` (modifica)
- Passi:
  1. Aggiungere al `README.md` della root una sezione "iOS app (IPA)" con:
     - prerequisiti: push mirror Gitea → GitHub che include i tag, Actions abilitate sul repo GitHub, secret `GITEA_TOKEN`, variable `API_BASE_URL=https://pal.septimilleso.uk/api`;
     - come si rilascia: tag `vX.Y.Z` creato e pushato solo su `origin` (Gitea), un tag alla volta, e `workflow_dispatch` come ripiego;
     - dove trovare l'IPA (release GitHub e Gitea);
     - installazione e aggiornamento manuale con SideStore, con il rinnovo ogni 7 giorni;
     - la nota che l'IPA non riceve Web Push e usa notifiche locali.
  2. Nella tabella "Environment variables" aggiungere `CORS_ALLOWED_ORIGINS`, con default `["capacitor://localhost"]`. In "Authentication model" aggiungere una riga sul Bearer per l'app nativa.
- Verifica: `grep -n "CORS_ALLOWED_ORIGINS\|API_BASE_URL\|SideStore" README.md` trova le tre voci. `cd web && npm test` è verde.

### [x] T14. Verifica remota completa del backend e deploy del branch

- Copre: C8, C9, C10, C11, C23, C24, C26
- Rischio: basso
- File: nessuno (solo esecuzione)
- Passi:
  1. In locale: `cd web && npm test` e `cd web && npm run build`, poi `git push origin feature/ipa-shell-ios`.
  2. Procedura R con l'intera suite (`python -m pytest -q`) sul DB isolato. Poi `docker compose up -d --build` per servire il branch su `https://pal.septimilleso.uk` e, sul server, aggiungere `CORS_ALLOWED_ORIGINS` al `.env` solo se il default non basta.
  3. Contro il deploy reale, provare la preflight: `curl -si -X OPTIONS https://pal.septimilleso.uk/api/auth/login -H "Origin: capacitor://localhost" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization, content-type, x-requested-with"`. Questo controlla che Cloudflare non alteri la risposta.
- Verifica:
  - suite pytest remota tutta verde, compresi `test_auth_bearer.py`, `test_auth_native.py`, `test_cors.py`, `test_auth_sessions.py`, `test_oauth_router.py`, `test_mcp_http.py`, `test_push_router.py` e `test_rest_notifier*.py`;
  - il `curl` restituisce 200 con `access-control-allow-origin: capacitor://localhost`;
  - la PWA dal browser fa login con cookie come prima.
  I fallimenti dovuti al DB condiviso vanno annotati senza dichiarare la feature verificata.

### [x] T15. Verifica CI e mirror con un tag di prova

- Copre: C12, C13
- Rischio: basso
- File: nessuno (solo esecuzione)
- Passi:
  1. L'utente controlla i prerequisiti: su GitHub la variable `API_BASE_URL` e il secret `GITEA_TOKEN`, e il push mirror su Gitea attivo.
  2. Creare il tag `v0.0.1` sulla testa di `feature/ipa-shell-ios` e fare `git push origin v0.0.1`, solo su Gitea. Mai push diretto su GitHub.
  3. Attendere la sincronizzazione del mirror e controllare che il tag compaia su GitHub e che parta il run "iOS release". Il controllo va fatto con `gh run list --workflow "iOS release"` in sola lettura, oppure dalla UI.
  4. A fine run, scaricare l'IPA dalla release Gitea, estrarla in una cartella temporanea nuova e leggere `Payload/App.app/Info.plist` (per esempio con `python -I -c "import plistlib,sys;print(plistlib.load(open(sys.argv[1],'rb'))['CFBundleShortVersionString'])" <path>`).
  5. Se il run fallisce, correggere sul branch e ripetere con `v0.0.2`, sempre un tag alla volta.
- Verifica:
  - il run "iOS release" del tag è verde;
  - la release GitHub e la release Gitea di `v0.0.1` contengono `yourfitnesspal-v0.0.1.ipa`;
  - l'IPA contiene `Payload/App.app` con `CFBundleShortVersionString` uguale a `0.0.1`.
  L'esito e il tempo di propagazione del mirror vanno annotati nel registro.

### [x] T16. Verifiche manuali su iPhone (SideStore) e sulla PWA

- Copre: C14, C15, C16, C17, C18, C19, C21, C23
- Rischio: basso
- File: nessuno (solo esecuzione)
- Passi: l'utente esegue i passi su iPhone con iOS 26, con il deploy di T14 attivo e l'IPA di T15.
  1. C14: installare l'IPA con SideStore (account gratuito). L'app si apre sulla schermata di login con la grafica esistente.
  2. C15:
     - login con password + TOTP, e compare il diario;
     - chiudere l'app dal multitasking e riaprirla: resta autenticata;
     - in Account › sessioni compare la sessione dell'IPA;
     - revocarla dal browser: alla prima azione l'IPA torna al login;
     - rifare il login, poi logout dall'IPA: serve un nuovo login.
  3. C16:
     - in Impostazioni attivare "Avviso fine riposo" e concedere il permesso;
     - completare una serie con riposo di 30 s e bloccare il telefono: alla scadenza arriva "Riposo finito · <nome>" con la campanella (o con il suono di sistema, da annotare quale);
     - ripetere passando a un'altra app;
     - toccare la notifica: si apre la sessione live.
  4. C17:
     - durante un riposo premere Salta, poi in un altro riposo finire l'allenamento, poi annullarne uno: nessuna notifica;
     - con +15 s arriva una sola notifica, alla nuova scadenza.
  5. C18: completando una serie si sente un feedback aptico. A fine riposo in primo piano si sentono campanella e feedback aptico.
  6. C19: in modalità aereo l'IPA si apre e mostra "Impossibile contattare il server" con "Riprova". Tolta la modalità aereo, Riprova carica i dati.
  7. C21 e C23 sulla PWA installata:
     - con l'avviso Web Push attivo arriva la notifica di fine riposo a schermo bloccato;
     - la PWA si apre offline dalla shell;
     - il logout funziona come prima.
- Verifica: esito di ogni punto (C14-C19, C21, C23) annotato nel registro, con il suono effettivamente usato dalla notifica. Un punto fallito blocca la chiusura della feature, il task va segnato `[!]` e serve un fix con un nuovo tag.

## Registro di esecuzione

Partenza: 424522cebccd82d6062ec328549c42acbb1653ef su main
- T1 punto 4: `npm run build` ok; in `dist/` ci sono `sw.js`, `registerSW.js`, `manifest.webmanifest`, `workbox-efbd304a.js`; `dist/index.html` referenzia `registerSW.js`.
- T1 — DONE — review: saltata (rischio basso)
- T2 — DONE — review: saltata (rischio basso); test DB da eseguire sul remoto con T3-T5 (rischio: password di test 'a brand new passphrase' in setup/complete)
- T3 — DONE — review: 1 round, APPROVED. MINOR: manca test cookie non valido + Bearer valido => 401; manca test auth_version superata con Bearer (api/tests/test_auth_bearer.py). Test DB da eseguire sul remoto dopo T5.
- T4 — DONE — review: 1 round, APPROVED. MINOR: X-YFP-Challenge accettato anche senza X-YFP-Client (sessions.py:104, innocuo, scelta da confermare); fixture session duplicata in test_auth_native.py; manca test totp con recovery_code via header. Test DB da eseguire sul remoto dopo T5.
- T5 — DONE — review: 2 round (1° CHANGES_REQUESTED MAJOR: CORS globale rompeva le preflight OAuth/MCP; corretto con ApiCORSMiddleware solo su /api/; 2° APPROVED). Test DB da eseguire sul remoto.
- Ambiente CI (verificato 2026-10-12, repo GitHub septimilleso/yourfitnesspal): mirror Gitea→GitHub ok, tag inoltrati e cancellazioni propagate (prova con tag `mirror-test`), workflow "iOS release" attivo, Actions abilitato, trigger solo tag `v*` (0 tag finora, per questo 0 run). DA FARE dall'utente prima di T15: variable `API_BASE_URL=https://pal.septimilleso.uk/api` e secret `GITEA_TOKEN` su GitHub (non verificabili senza credenziali).
- Ambiente CI: l'utente conferma di aver creato su GitHub la variable API_BASE_URL e il secret GITEA_TOKEN (non verificabile da qui).
- Verifica remota T2-T5 (server, DB isolato yfp_test, riportata dall'utente 2026-10-12): 77 passed, 3 failed su test_config.py::test_push_disabled_without_vapid_settings, test_mcp_http.py::test_metadata_documents, test_oauth_router.py::test_me_exposes_mcp_url, tutti preesistenti e dipendenti dall'ambiente del server (VAPID e PUBLIC_BASE_URL reali). Rilanciati con le variabili forzate (PUBLIC_BASE_URL=http://localhost:6500, VAPID vuote): 26 passed. Tutti i test nuovi di T2-T5 verdi. Resta la suite intera in T14.
- T6 scelta Capacitor: major 7 (`@capacitor/core`, `@capacitor/ios` e `@capacitor/cli` 7.6.9), perché Capacitor 8 richiede Xcode 26 e il default di macos-15 è Xcode 16.4 (Capacitor 7 richiede Xcode 16.0+).
- T6 — DONE — review: 1 round, APPROVED. Deviazione: `npx cap add ios --packagemanager SPM` è uscito con exit 1 (ENOENT Podfile) per un bug della CLI 7.6.9 (`getPackageManager` confronta "spm" con 'SPM' in @capacitor/cli/dist/index.js:193, quindi l'add chiama `updatePodfile`); il progetto SPM era già generato e `npx cap sync ios` lo ha completato (exit 0). Regola: in CI si usa solo `cap sync`, mai `cap add`. MINOR da verificare in T15: assenza di `xcshareddata/xcschemes` in App.xcodeproj; se xcodebuild non trova lo schema `App`, va generato e condiviso. npm audit segnala vulnerabilità non analizzate (non verificato se nuove).
- T7 — DONE — review: 1 round, APPROVED. MINOR: (1) web/ios/App/CapApp-SPM/Package.swift:15 contiene path con backslash scritti da cap sync su Windows: file rigenerato da `npx cap sync ios` su macOS in CI prima di xcodebuild, vale anche per T9 e T11 (verificare in T15; non committare a mano); (2) client.ts:62 race su 401 tardivo che cancella un token nuovo (clearToken solo se getToken() === token inviato); (3) VITE_API_BASE_URL senza normalizzazione dello slash finale (documentare in T13: senza slash finale); (4) manca test: nessun challenge inviato a /auth/* se non impostato.
- T8 — DONE — review: 1 round, APPROVED. MINOR: (1) AuthContext.tsx:49 se Preferences.remove fallisce clearToken() rifiuta e useLogout non svuota cache né naviga (fix: `await clearToken().catch(() => undefined)`); (2) api/auth.ts:13-15 keepNativeSession: se Preferences.set fallisce verifyTotp/setupComplete rifiutano a sessione server già creata (fix: intercettare l'errore di persistenza e proseguire col token in memoria). Challenge non azzerato sui fallimenti: giudicato corretto (serve a riprovare il TOTP entro 300 s).
- T9 — DONE — review: 1 round, APPROVED. MINOR: (1) NativeBridge.tsx:32-33 naviga a extra.url senza validare (usare safeNext o accettare solo /gym/workout); (2) AuthContext.tsx:44-45 cancel al logout prima di logout()/clearClientCaches: un refetch di gymKeys.active in quella finestra può riprogrammare la notifica (richiamare cancelRestNotification dopo clearClientCaches); (3) commento errato in restNotifications.test.ts:29 (il server è avanti di 5 s). Suono rest-bell.wav come suono di notifica da verificare su iPhone (C16). npm audit: 16 vulnerabilità non analizzate.
- T10 — DONE — review: 1 round, APPROVED. MINOR: NativeRestAlertSetting.tsx:61-65 se setRestAlertsEnabled(true) riesce ma syncRestNotification lancia, il toggle resta spento con Preferences già abilitato (stato incoerente); simmetrico in disattivazione (:52-54); mancano test dei percorsi di errore (requestPermissions, setRestAlertsEnabled, syncRestNotification, checkPermissions).
- T11 — DONE — review: 1 round, APPROVED. MINOR: RestTimerBar.native.test.tsx:45-60 non verifica che l'haptic avvenga insieme a beep() e vibrate() (aggiungere expect su beep e vibrate). Aggiunto fuori elenco file: SetRow.native.test.tsx. Haptic reale su iPhone da verificare in C18.
- T12 — DONE — review: saltata (rischio basso); diff del workflow letto dall'orchestratore. Aggiunto step diagnostico 'xcodebuild -list' (|| true) per il caso schema App non condiviso. Verifica reale in T15.
- T13 — DONE — review: saltata (rischio basso). README: sezione 'iOS app (IPA)', CORS_ALLOWED_ORIGINS, Bearer nativo. Impostazioni esterne (mirror, Actions, secret) descritte, non verificate dall'agent.
- T14 (parte pytest) — suite intera sul server, DB isolato yfp_test, con PUBLIC_BASE_URL=http://localhost:6500 e VAPID vuote (riportato dall'utente 2026-10-12): feature 24 falliti / 394 passed; baseline origin/main 24 falliti; confronto con comm: nessun test fallisce solo sulla feature, nessuno solo su main. Nessuna regressione (C26 soddisfatto a meno dei 24 fallimenti preesistenti del DB condiviso, tutti identici al baseline). Restano in T14: deploy del branch (docker compose up -d --build) e preflight curl su pal.septimilleso.uk, decisione dell'utente.
- T15 — run GitHub 38302333605 (tag v0.0.1 pushato solo su Gitea, mirror ok): attempt 1 fallito allo step 'Build web and sync Capacitor' per variable API_BASE_URL assente (il controllo ha funzionato); attempt 2 dopo correzione della variable (re-run): tutti gli step success, compresi 'Build unsigned app' (xcodebuild con schema App, nessun problema di schema condiviso né di Package.swift rigenerato), 'Check app version matches tag', 'GitHub release' e 'Gitea release'. Release GitHub v0.0.1 con yourfitnesspal-v0.0.1.ipa (3197210 byte). Release Gitea non verificabile senza credenziali (repo privato): conferma dell'utente richiesta. C12 ok, C13 ok lato GitHub.
- T14 — DONE: deploy del branch sul server; prima del rebuild di api la preflight rispondeva 404 senza header CORS (container vecchio, app 'Impossibile contattare il server'); dopo `docker compose up -d --build api`, curl su pal.septimilleso.uk (2026-10-12): preflight da capacitor://localhost 200 con access-control-allow-origin: capacitor://localhost e header consentiti (Authorization, Content-Type, X-Requested-With, X-YFP-Challenge, X-YFP-Client); origin https://evil.example 400 senza ACAO; GET /api/auth/me con Origin nativo 401 con ACAO; preflight OAuth /token da altro origin invariata (200, ACAO *). Cloudflare non altera le risposte. C11 ok sul dominio reale.
- T16 — DONE (riportato dall'utente 2026-10-12, iPhone con SideStore, deploy attivo): "funziona tutto" per i passi di T16 eseguiti (installazione, login, notifiche locali, haptics, PWA), senza esito dettagliato punto per punto né annotazione del suono usato dalla notifica. In modalità aereo l'IPA mostra 'Impossibile contattare il server' (C19, come da spec); l'utente si aspettava l'apertura offline con dati in cache: rimandata alla prossima feature.
Review 1 — APPROVED (0 BLOCKER, 0 MAJOR, 4 MINOR da correggere nella prossima feature, 6 MINOR accettati; 2 avvisi nuovi: evidenza C14-C18, C26 non letterale)
- Evidenza C16 (utente, 2026-10-12): la notifica suona con il suono di sistema, non con rest-bell.wav (ripiego ammesso da R9). Follow-up: capire perché iOS non usa il file in Library/Sounds.
