# Piano: Campanella a fine riposo

- Data: 2026-09-30
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: feature
- Branch: feature/campanella-fine-riposo

## Approccio

Il piano segue l'approccio A della spec e l'[ADR 0001](../../decisions/0001-web-push-scheduler-in-process.md). Prima vengono i test di caratterizzazione sul web, poi l'API: config VAPID, modello e migrazione, router delle subscription, claim dei riposi scaduti, invio e loop nel `lifespan` di `api/app/main.py`. Per ultimo il web: service worker, client push, toggle in Impostazioni, logout e campanella. Chiudono la verifica sul deploy remoto e quella sul dispositivo.

**API.**
- Il campo nuovo su `workouts` si chiama `rest_notified_at` e contiene il valore di `rest_ends_at` già notificato. Il claim è un solo `UPDATE ... SET rest_notified_at = rest_ends_at WHERE status = 'in_progress' AND rest_ends_at <= :now AND rest_ends_at > :now - 60s AND rest_notified_at IS DISTINCT FROM rest_ends_at RETURNING id, user_id, name`. Con READ COMMITTED Postgres ricontrolla il `WHERE` dopo il lock di riga, quindi due claim concorrenti non prendono lo stesso riposo (C6).
- Aggiusta, salta, fine e annullamento cambiano o cancellano `rest_ends_at`, oppure eliminano il workout. Per questo `api/app/services/workouts.py` non va toccato: `_start_rest`, `_clear_rest`, `rest`, `finish_workout` e `delete_workout` restano come sono, e i test in `api/tests/test_workouts_live.py` e `test_workouts_finish.py` fanno già da caratterizzazione lato server (C15).
- L'invio passa per un'interfaccia `PushSender`: una funzione async che riceve la subscription e il payload e restituisce `sent`, `gone` o `failed`. Nei test la sostituisce un fake. In produzione è un wrapper di `pywebpush.webpush_async` (pywebpush 2.5, basato su aiohttp, quindi non blocca l'event loop).
- Il loop legge le sessioni DB da `app.db.session_scope()`, come i tool MCP. Così i test con la fixture `db` di `api/tests/conftest.py` lo pilotano senza modifiche.
- `httpx.ASGITransport` non esegue il `lifespan`, quindi nei test il loop non parte mai da solo.

**Web.**
- Resta `generateSW`. Gli handler `push` e `notificationclick` stanno in `web/public/push-sw.js`, caricato con l'opzione `workbox.importScripts`. È JS semplice che usa solo `self`, così un test vitest lo può eseguire con un `self` finto.
- Le API del browser (Notification, PushManager, service worker) sono chiuse in `web/src/lib/push.ts`, che i test dei componenti mockano.
- Lo stato del dispositivo si legge con `navigator.serviceWorker.getRegistration()`, non con `.ready`, che senza service worker (dev e test) non si risolve mai.
- La campanella è un file WAV generato da uno script nostro (`web/scripts/make-bell.mjs`, nessuna licenza di terzi), salvato in `web/public/sounds/rest-bell.wav` e aggiunto al precache con l'estensione `wav` nei `globPatterns`.
- `web/src/lib/restTimer.ts` tiene il nome `beep()` ma suona il campione. Così i test esistenti di `RestTimerBar.test.tsx`, che mockano `beep`, restano invariati come chiede C15.

**Copertura attuale.** La verifica ha dato questo quadro:
- `RestTimerBar` è coperto solo in parte: manca il caso "non visto in corso".
- `useLogout` e `clearClientCaches` non hanno test.
- `SettingsPage.test.tsx` copre già C20.
- `services/workouts.rest` è coperto dai test pytest esistenti.

T1 scrive quindi i test di caratterizzazione mancanti sul web.

**Verifica API in locale.** Qui non c'è Postgres. Per i task API la verifica locale si limita a:
- `ruff`;
- import di `app.main`;
- test senza DB;
- `pytest --collect-only`;
- `alembic upgrade --sql` in modalità offline.

I test con DB girano sul deploy remoto in T13: push del branch, `git pull` sul server, `pytest` lì. Nessun task dichiara verdi test DB eseguiti in locale.

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Branch e test di caratterizzazione sul web

- Copre: C7 (comportamento attuale), C8 (comportamento attuale), C15, C19 (svuotamento cache al logout), C21
- File: `web/src/components/gym/RestTimerBar.test.tsx` (modifica), `web/src/auth/AuthContext.test.tsx` (nuovo)
- Passi:
  1. Verificare di essere su `feature/campanella-fine-riposo` creato da `main` (`git branch --show-current`). Se non esiste, crearlo da `main`.
  2. In `RestTimerBar.test.tsx` aggiungere casi senza toccare quelli esistenti:
     - montato con `rest_ends_at` già nel passato, quindi riposo mai visto in corso: nessuna chiamata a `beep` o `vibrate`, barra assente;
     - con `rest_ends_at: null`: nessuna chiamata a `beep`;
     - dopo lo zero, un `rerender` con un nuovo `rest_ends_at` futuro che arriva a zero fa suonare `beep` una seconda volta (una volta per ogni valore).
  3. Creare `AuthContext.test.tsx` per `useLogout`. Mockare `logout` di `../api/auth` e `useNavigate`. Usare un `QueryClient` reale con `vi.spyOn(queryClient, "clear")` e stubbare `window.caches` con `{ delete: vi.fn().mockResolvedValue(true) }`. Verificare l'ordine con `mock.invocationCallOrder`: `logout()`, poi `queryClient.clear()`, poi `caches.delete("api-foods-cache")`, poi `navigate("/login", { replace: true })`. Eseguire l'hook con `renderHook` dentro `QueryClientProvider` e `MemoryRouter`.
- Verifica: `cd web && npx vitest run src/components/gym/RestTimerBar.test.tsx src/auth/AuthContext.test.tsx`, risultato atteso: tutti verdi sul codice attuale. Poi `cd web && npm test`: suite verde.

### [x] T2. Configurazione VAPID, dipendenza pywebpush e generazione chiavi

- Copre: C22 (parte config), R4 (lato server), requisito di avvio senza chiavi
- File: `api/app/config.py` (modifica), `api/pyproject.toml` (modifica), `api/scripts/gen_vapid_keys.py` (nuovo), `api/tests/test_config.py` (modifica), `.env.example` (modifica), `README.md` (modifica)
- Passi:
  1. In `Settings` aggiungere `vapid_public_key: str = ""`, `vapid_private_key: str = ""` e `vapid_subject: str = ""` (per esempio `mailto:you@example.com`). Aggiungere la property `push_enabled`, vera solo se tutti e tre sono valorizzati.
  2. In `pyproject.toml` aggiungere `"pywebpush>=2.5,<3"` alle dipendenze. È compatibile con `cryptography` 50 già presente. Poi `.venv/Scripts/python -m pip install -e ".[dev]"`.
  3. Creare `api/scripts/gen_vapid_keys.py`, che con `cryptography` genera una chiave P-256 e stampa due righe `.env`:
     - `VAPID_PRIVATE_KEY`: i 32 byte privati in base64url senza padding, formato "raw" accettato da `py_vapid.Vapid.from_string`;
     - `VAPID_PUBLIC_KEY`: il punto non compresso di 65 byte in base64url, cioè l'`applicationServerKey` del browser.
  4. Documentare in `.env.example` le tre variabili, commentate. Spiegare che senza di esse l'avviso push è disattivato e il resto dell'app funziona. In `README.md`, sezione deploy, aggiungere come generarle con lo script e la nota sulla migrazione nuova.
  5. In `test_config.py` (test senza DB) aggiungere due casi: per default `push_enabled` è falso; con i tre valori `Settings(vapid_public_key=..., ...)` è vero.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests scripts`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_config.py -q`: verde;
  - `.venv/Scripts/python scripts/gen_vapid_keys.py`: stampa due righe; la pubblica decodificata è lunga 65 byte e inizia con `0x04`.

### [x] T3. Modello `PushSubscription`, campo `rest_notified_at` e migrazione

- Copre: C22 (migrazione), R5 (unicità per endpoint), R7 (riposi scaduti prima della migrazione)
- File: `api/app/models/push.py` (nuovo), `api/app/models/__init__.py` (modifica), `api/app/models/workout.py` (modifica), `api/alembic/versions/e3f9b2a7c514_push_subscriptions.py` (nuovo), `api/tests/test_push_models.py` (nuovo)
- Passi:
  1. Creare `PushSubscription`, tabella `push_subscriptions`, con queste colonne:
     - `id`;
     - `user_id`: FK `users.id` con `ondelete="CASCADE"`, indicizzata;
     - `endpoint`: `Text`, `unique=True`, non null;
     - `p256dh`: `String(200)`;
     - `auth`: `String(100)`;
     - `created_at` e `updated_at`, con lo stesso stile di `WorkoutTemplate`.

     Esportare la classe da `app/models/__init__.py`.
  2. In `Workout` aggiungere `rest_notified_at: Mapped[datetime | None]` (`DateTime(timezone=True)`, nullable), con un commento: "valore di `rest_ends_at` per cui è già partito il push". In `__table_args__` aggiungere l'indice parziale `ix_workouts_rest_pending` su `rest_ends_at` con `postgresql_where=sa.text("status = 'in_progress' AND rest_ends_at IS NOT NULL")`, per la query al secondo del requisito di prestazioni.
  3. Creare la migrazione `e3f9b2a7c514` con `down_revision = "d5e8a1c3f720"`, sul modello di `d5e8a1c3f720_user_activity_days.py`. L'`upgrade` fa tre cose:
     - crea la tabella;
     - aggiunge la colonna e l'indice parziale;
     - esegue `UPDATE workouts SET rest_notified_at = rest_ends_at WHERE rest_ends_at IS NOT NULL AND rest_ends_at <= now()`, così i riposi già scaduti non partono. La finestra di 60 s in T5 fa da seconda protezione.

     Il `downgrade` rimuove indice, colonna e tabella.
  4. In `test_push_models.py` (DB, gira sul remoto) aggiungere tre casi:
     - due righe con lo stesso `endpoint` sollevano `IntegrityError`;
     - eliminare l'utente elimina le sue subscription;
     - un workout nuovo ha `rest_notified_at` a `None`.

     Usare `make_user` di `tests/factories.py`, come in `test_gym_models.py`.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -c "import app.main"`: nessun errore;
  - `.venv/Scripts/python -m alembic upgrade d5e8a1c3f720:e3f9b2a7c514 --sql`: stampa il DDL (CREATE TABLE, ALTER TABLE, CREATE INDEX, UPDATE) senza errori, in modalità offline senza DB;
  - `.venv/Scripts/python -m pytest --collect-only -q`: nessun errore di import.

  I test DB vengono eseguiti in T13.

### [x] T4. Servizio e router delle subscription push

- Copre: C3 (deduplica, cancellazione solo delle proprie, CSRF), R5, R12, R4 (chiave pubblica assente)
- File: `api/app/schemas/push.py` (nuovo), `api/app/services/push.py` (nuovo), `api/app/routers/push.py` (nuovo), `api/app/main.py` (modifica), `api/tests/test_push_router.py` (nuovo)
- Passi:
  1. Schemi pydantic:
     - `PushKeys(p256dh: str ≤200, auth: str ≤100)`;
     - `PushSubscriptionIn(endpoint: str ≤2048, keys: PushKeys)`, dove `endpoint` deve essere un URL `https://` il cui host è in una allowlist dei push service noti (validator): esattamente `web.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com`, oppure un host che termina con `.notify.windows.com`. Così il server non fa POST verso URL arbitrari;
     - `PushUnsubscribeIn(endpoint: str)`;
     - `PushConfigOut(public_key: str | None)`.
  2. Servizio `app/services/push.py`:
     - `subscribe(db, user, payload)` fa un upsert su `endpoint` con `sqlalchemy.dialects.postgresql.insert(...).on_conflict_do_update(index_elements=["endpoint"], set_={user_id, p256dh, auth, updated_at})`, così lo stesso endpoint passa all'utente corrente (R5);
     - `unsubscribe(db, user, endpoint)` cancella solo con `user_id == user.id AND endpoint == endpoint` ed è idempotente;
     - `remove_endpoints(db, endpoints)` servirà a T5.
  3. Router `app/routers/push.py` con prefisso `/api/push`:
     - `GET /config` risponde `PushConfigOut`, con `public_key` uguale a `settings.vapid_public_key` se `settings.push_enabled`, altrimenti `None`. La chiave privata non compare mai nelle risposte;
     - `POST /subscriptions` risponde 204;
     - `POST /unsubscribe` risponde 204.

     Registrarlo in `main.py` con `dependencies=[Depends(get_current_user)]`, come gli altri router. Basta l'autenticazione, perché il logout (T10) deve poter cancellare anche per utenti senza `workouts`.
  4. `test_push_router.py` (DB, remoto) usa `http_client(db, user)` da `tests/factories.py` e verifica:
     - due `POST /subscriptions` con lo stesso endpoint producono una sola riga; il secondo da `bob` riassegna la riga a bob;
     - `POST /unsubscribe` di bob su un endpoint di alice lascia la riga;
     - `POST /subscriptions` con `http_client(..., csrf=False)` riceve 403 `{"detail": "csrf"}`;
     - senza login si riceve 401;
     - `GET /config` restituisce `public_key: null` con la configurazione di default e la chiave con `monkeypatch.setattr` sulle tre impostazioni di `app.config.settings`;
     - un endpoint `http://` riceve 422;
     - un endpoint `https://` con host fuori allowlist (es. `https://example.com/x`, `https://web.push.apple.com.evil.com/x`) riceve 422; `https://web.push.apple.com/...` e `https://wns2-par02p.notify.windows.com/...` sono accettati.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -c "import app.main"`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_push_router.py --collect-only -q`: raccoglie i test senza errori.

  Esecuzione reale in T13.

### [x] T5. Claim dei riposi scaduti e iterazione dello scheduler

- Copre: C3 (subscription 410 rimossa), C4, C5, C6, R6, R7
- File: `api/app/services/rest_notifier.py` (nuovo), `api/tests/test_rest_notifier.py` (nuovo), `api/tests/test_rest_notifier_race.py` (nuovo)
- Passi:
  1. In `rest_notifier.py` definire:
     - `PushResult` (enum `sent`, `gone`, `failed`);
     - il tipo `PushSender = Callable[[dict, str], Awaitable[PushResult]]`, che riceve la `subscription_info` nel formato pywebpush (`{"endpoint", "keys": {"p256dh", "auth"}}`) e il payload JSON;
     - la costante `MAX_LATE = timedelta(seconds=60)`.
  2. `claim_due_rests(db, now) -> list[DueRest]` esegue l'`UPDATE ... RETURNING` descritto nell'Approccio con `sa.update(Workout)` e `execution_options(synchronize_session=False)`. `DueRest` è una dataclass con `workout_id`, `user_id` e `name`.
  3. `rest_payload(name) -> str` produce il JSON `{"title": "Riposo finito · <nome>", "url": "/gym/workout"}`, oppure solo `"Riposo finito"` se il nome è vuoto o fatto di spazi. Nessun altro dato personale.
  4. `notify_due_rests(sender, now) -> int` esegue questi passi:
     - apre una sessione con `session_scope()`, fa il claim e `commit`;
     - legge le `PushSubscription` degli utenti coinvolti;
     - invia con `asyncio.gather` a tutte le subscription;
     - rimuove con `remove_endpoints` quelle con esito `gone` e fa `commit`;
     - registra con `logging` gli esiti `failed`;
     - restituisce il numero di invii tentati.
  5. `test_rest_notifier.py` (DB, remoto) usa la fixture `clock` di `test_workouts_live.py`, da copiare o spostare in `conftest.py` senza cambiarne il comportamento, e un fake sender che registra le chiamate. Filtra le chiamate sugli endpoint dell'utente di test. Casi:
     - C4: una serie completata con riposo di 90 s e 2 subscription. `notify_due_rests(fake, T0+91s)` produce 2 invii con titolo "Riposo finito · Giorno 1". Una seconda iterazione non ne produce altri;
     - C5: dopo `RestIn(skip=True)` nessun invio a T0+91s;
     - C5: dopo `RestIn(delta_s=15)`, a T0+91s nessun invio e a T0+106s un invio; a T0+107s ancora nessuno;
     - C5: `finish_workout` prima della scadenza, poi nessun invio a T0+91s;
     - C5: `delete_workout` prima della scadenza, poi nessun invio;
     - C5: iterazione a T0+90+61s senza iterazioni precedenti: nessun invio;
     - C3: il fake restituisce `gone` per un endpoint; dopo l'iterazione quella riga non esiste più e l'altra sì;
     - `rest_payload("")` vale `"Riposo finito"`.
  6. `test_rest_notifier_race.py` (DB, remoto) copre C6. Non usa la fixture `db` a transazione unica: crea l'utente `zzq-push-race` e un workout in corso con `rest_ends_at` scaduto in una sessione `AsyncSessionLocal` con `commit`. Poi esegue `asyncio.gather` di due claim su due sessioni distinte, ognuna con `commit`, e verifica che la somma delle righe restituite sia 1. Nel `finally` elimina l'utente, e il workout se ne va in cascata.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_rest_notifier.py tests/test_rest_notifier_race.py --collect-only -q`: raccoglie i test senza errori.

  Esecuzione reale in T13.

### [~] T6. Invio con pywebpush, loop e avvio nel lifespan

- Copre: C4 (invio reale), requisiti di affidabilità e avvio, R6
- File: `api/app/services/push.py` (modifica), `api/app/services/rest_notifier.py` (modifica), `api/app/main.py` (modifica), `api/tests/test_push_sender.py` (nuovo), `api/tests/test_rest_notifier_loop.py` (nuovo)
- Passi:
  1. In `services/push.py` aggiungere `make_webpush_sender(settings, http_session) -> PushSender`. Il `Vapid` si costruisce una sola volta con `py_vapid.Vapid.from_string(settings.vapid_private_key)`. Ogni chiamata usa `pywebpush.webpush_async` con questi parametri:
     - `vapid_claims={"sub": settings.vapid_subject}` nuovo a ogni chiamata, perché pywebpush scrive `aud` nel dict e un dict condiviso porterebbe l'`aud` del primo push service agli altri;
     - `ttl=60`;
     - `headers={"Urgency": "high"}`;
     - `timeout=5`;
     - `aiohttp_session=http_session`.

     Per gli errori: `WebPushException` con `status_code` 404 o 410 dà `gone`, con un altro codice dà `failed`. Qualsiasi altra eccezione (rete, timeout) dà `failed` e finisce nel log.
  2. In `rest_notifier.py` aggiungere la classe `RestNotifier`:
     - `start()` crea la `aiohttp.ClientSession` e il task `asyncio.create_task(run_loop(...))`, solo se `settings.push_enabled` e la chiave privata è valida; altrimenti scrive un log informativo e restituisce senza avviare nulla;
     - `stop()` cancella il task, lo attende sopprimendo `CancelledError` e chiude la sessione aiohttp.

     `run_loop(sender, interval=1.0)` è un ciclo `while True`: `notify_due_rests(sender, workouts.now())` dentro `try/except Exception` con `logger.exception`, poi `asyncio.sleep(interval)`. Un errore non ferma mai il loop.
  3. In `lifespan` di `main.py` creare e avviare `RestNotifier` accanto a `OffClient`, e fermarlo nel `finally`.
  4. `test_push_sender.py` (senza DB, gira in locale) sostituisce con `monkeypatch` `webpush_async` nel modulo `app.services.push` e verifica:
     - esito ok dà `sent`, con claims che contengono `sub` e headers che contengono `Urgency: high`;
     - due chiamate consecutive ricevono dict di claims distinti;
     - `WebPushException(response=SimpleNamespace(status=410))` dà `gone`, `status=404` dà `gone`, `status=500` dà `failed`;
     - un `aiohttp.ClientError` dà `failed`.

     Le chiavi di test si generano nel test con la stessa funzione dello script di T2.
  5. `test_rest_notifier_loop.py` (senza DB, locale) verifica:
     - con `notify_due_rests` sostituito da un mock che solleva alla prima chiamata e poi segnala un `asyncio.Event`, `run_loop` con `interval=0` arriva alla seconda chiamata; poi si cancella il task;
     - `RestNotifier.start()` senza chiavi non crea task.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_push_sender.py tests/test_rest_notifier_loop.py tests/test_config.py -q`: verdi in locale;
  - `.venv/Scripts/python -c "import app.main"`: nessun errore.

### [ ] T7. Service worker: handler `push` e `notificationclick`

- Copre: C9, C19, R8
- File: `web/public/push-sw.js` (nuovo), `web/vite.config.ts` (modifica), `web/src/sw/pushSw.test.ts` (nuovo)
- Passi:
  1. Creare `web/public/push-sw.js` (JS semplice, solo `self`).
     - `push`: legge `event.data?.json()` dentro un try; se il payload manca o non è valido usa `{ title: "Riposo finito", url: "/gym/workout" }`. Poi chiama `event.waitUntil(self.registration.showNotification(title, { body: "", icon: "/pwa-192x192.png", data: { url } }))`. La notifica si mostra sempre, anche con un client visibile. Niente `tag`, così ogni avviso suona (una sostituzione con lo stesso `tag` è silenziosa e WebKit non supporta `renotify`). Prima di `showNotification`, dentro lo stesso `waitUntil`, chiudere le notifiche precedenti: `self.registration.getNotifications()` e `close()` su ognuna, in un try. Se l'API manca o fallisce si mostra comunque la nuova notifica (fallback: le notifiche si accumulano).
     - `notificationclick`: `event.notification.close()`, poi `event.waitUntil(...)`. Cerca con `self.clients.matchAll({ type: "window", includeUncontrolled: true })` un client della stessa origine: se esiste chiama `focus()` e, se l'URL non è già `/gym/workout`, `navigate(url)` in un try. Se non esiste chiama `self.clients.openWindow(url)`.
  2. In `vite.config.ts`, dentro `workbox`, aggiungere `importScripts: ["push-sw.js"]`. Non toccare `navigateFallbackDenylist`, `runtimeCaching` e `registerType`.
  3. `pushSw.test.ts` legge `public/push-sw.js` con `fs.readFileSync` e lo esegue con `new Function("self", code)(fakeSelf)`. `fakeSelf` ha `addEventListener` che registra gli handler, `registration.showNotification` mock e `clients` mock. Casi:
     - un payload `{ title: "Riposo finito · Push A" }` mostra quella notifica;
     - un payload assente mostra "Riposo finito";
     - con due notifiche già presenti (`getNotifications` mock che restituisce oggetti con `close` mock), un push chiama `close` su entrambe prima di `showNotification`;
     - se `getNotifications` lancia o non esiste, la notifica viene mostrata comunque;
     - un payload non JSON mostra "Riposo finito";
     - il click con un client esistente chiama `focus` e `navigate("/gym/workout")`;
     - il click senza client chiama `openWindow("/gym/workout")`.
- Verifica:
  - `cd web && npx vitest run src/sw/pushSw.test.ts`: verde;
  - `cd web && npm run build`: build senza errori;
  - `grep -c "push-sw.js" web/dist/sw.js`: almeno 1;
  - `grep -c "addEventListener(\"push\"" web/dist/push-sw.js`: 1;
  - `grep -c "notificationclick" web/dist/push-sw.js`: 1;
  - `grep -c "api-foods-cache" web/dist/sw.js`: almeno 1, la cache è preservata;
  - `cd web && npm test`: suite verde.

### [ ] T8. Client push: API e helper del browser

- Copre: C2 (logica), R2, R3, R4, C18
- File: `web/src/api/push.ts` (nuovo), `web/src/lib/push.ts` (nuovo), `web/src/lib/push.test.ts` (nuovo)
- Passi:
  1. `api/push.ts` usa `client` di `web/src/api/client.ts`, che aggiunge già `X-Requested-With: yfp`, ed espone:
     - `getPushConfig()`, che fa `GET /push/config`;
     - `subscribePush(sub: PushSubscriptionJSON)`, che fa `POST /push/subscriptions` con `{ endpoint, keys }`;
     - `unsubscribePush(endpoint)`, che fa `POST /push/unsubscribe`.
  2. `lib/push.ts` espone:
     - `pushAvailability(): "unsupported" | "denied" | "available"`. Dà `"unsupported"` se manca `serviceWorker` in `navigator` o se mancano `PushManager` o `Notification` in `window`, e `"denied"` se `Notification.permission === "denied"`;
     - `urlBase64ToUint8Array(key)`;
     - `currentSubscription()`, via `navigator.serviceWorker.getRegistration()` e poi `pushManager.getSubscription()`; restituisce `null` se manca la registration;
     - `isDeviceSubscribed()`, vero se c'è una subscription e `Notification.permission === "granted"` (R3);
     - `enableRestAlerts(publicKey): Promise<"enabled" | "denied">`. `Notification.requestPermission()` deve essere il primo `await` dopo il tap: iOS lo chiede nel gesto utente, e per questo la chiave pubblica arriva già pronta come parametro. Poi `navigator.serviceWorker.ready`, poi `getSubscription() ?? subscribe({ userVisibleOnly: true, applicationServerKey })`, infine `subscribePush`. Se `subscribePush` fallisce, fa `unsubscribe()` locale e rilancia l'errore;
     - `disableRestAlerts()`: `unsubscribePush(endpoint)` e poi `sub.unsubscribe()`;
     - `unsubscribeDeviceOnLogout()`: best effort. Esegue lo stesso di `disableRestAlerts` con timeout di 3 s, ignora ogni errore e non fa nulla senza registration.

     Nessuna funzione chiede il permesso fuori da `enableRestAlerts` (C18).
  3. `push.test.ts` sostituisce `Notification`, `PushManager` e `navigator.serviceWorker` con stub `vi.stubGlobal` / `Object.defineProperty` e mocka `../api/push`. Casi:
     - le tre uscite di `pushAvailability`;
     - `enableRestAlerts` con permesso concesso chiama `subscribe` e `subscribePush`;
     - con permesso negato restituisce `"denied"` e non chiama `subscribePush`;
     - `disableRestAlerts` chiama server e browser;
     - `unsubscribeDeviceOnLogout` senza registration non lancia;
     - `unsubscribeDeviceOnLogout` con `unsubscribePush` che fallisce non lancia;
     - `urlBase64ToUint8Array` su una chiave nota.
- Verifica: `cd web && npx vitest run src/lib/push.test.ts`, verde; `cd web && npx tsc -b`, nessun errore di tipo.

### [ ] T9. Toggle "Avviso fine riposo" in Impostazioni

- Copre: C1, C2, C18, C20
- File: `web/src/components/RestAlertSetting.tsx` (nuovo), `web/src/components/RestAlertSetting.test.tsx` (nuovo), `web/src/pages/SettingsPage.tsx` (modifica), `web/src/pages/SettingsPage.test.tsx` (modifica)
- Passi:
  1. `RestAlertSetting` legge `getPushConfig` con `useQuery` (chiave `["push-config"]`), `pushAvailability()` e, in un effect, `isDeviceSubscribed()`. Mostra una sezione `card` con un `input type="checkbox" role="switch"` e l'etichetta "Avviso fine riposo", più il testo sul Focus: "Per sentirlo in palestra con un Focus attivo, aggiungi YFP alle app consentite del Focus (Impostazioni iOS › Focus)."
     - Con `unsupported` il toggle è disabilitato con "Installa YFP nella schermata Home per attivare l'avviso".
     - Con `denied`: disabilitato con "Permesso notifiche negato: riabilitalo in Impostazioni iOS › Notifiche › YFP".
     - Con `public_key` null: disabilitato con "Avviso non configurato sul server".
     - Il tap chiama `enableRestAlerts(publicKey)` o `disableRestAlerts()`, con stato di attesa. Se la risposta è `"denied"` compare il messaggio del permesso negato. Gli errori di rete danno un messaggio breve.
  2. In `SettingsPage.tsx` rendere `<RestAlertSetting />` in una seconda `section` solo se `useHasPermission("workouts.use")`. La sezione di link Account e Gestione utenti resta invariata.
  3. `RestAlertSetting.test.tsx` mocka `../lib/push` e `../api/push`. Casi:
     - C1: con `PushManager` assente (`pushAvailability` restituisce `"unsupported"`) il toggle è disabilitato e mostra "schermata Home";
     - C2: con permesso concesso, attivando il toggle si chiama `enableRestAlerts` con la chiave e il toggle risulta `checked`; disattivandolo si chiama `disableRestAlerts` e il toggle torna spento;
     - C2: se `enableRestAlerts` restituisce `"denied"`, il toggle resta spento, compare il messaggio e il server non viene chiamato (`subscribePush` non viene mai invocato);
     - con `public_key: null` il toggle è disabilitato e mostra "non configurato";
     - C18: il solo render non chiama `enableRestAlerts` né `Notification.requestPermission`.
  4. In `SettingsPage.test.tsx` lasciare invariati i tre test esistenti e mockare `RestAlertSetting` con un segnaposto. Aggiungere due casi per C1: con `useHasPermission` vero il toggle c'è, con falso non c'è.
- Verifica: `cd web && npx vitest run src/components/RestAlertSetting.test.tsx src/pages/SettingsPage.test.tsx`, verdi con i test esistenti invariati; `cd web && npm test`, suite verde.

### [ ] T10. Il logout disattiva l'avviso sul dispositivo

- Copre: C8, C19 (svuotamento cache invariato), R11
- File: `web/src/auth/AuthContext.tsx` (modifica), `web/src/auth/AuthContext.test.tsx` (modifica)
- Passi:
  1. In `useLogout`, prima di `logout()` chiamare `await unsubscribeDeviceOnLogout()`. La cancellazione sul server richiede la sessione ancora valida, quindi deve venire prima di `logout()` e di conseguenza prima di `clearClientCaches`. `clearClientCaches` non cambia, e `LoginPage.tsx` lo usa ancora così com'è.
  2. In `AuthContext.test.tsx` mockare `../lib/push` e aggiungere due casi:
     - C8: `unsubscribeDeviceOnLogout` viene chiamata prima di `logout()` e prima di `caches.delete("api-foods-cache")` (`invocationCallOrder`);
     - se `unsubscribeDeviceOnLogout` si risolve dopo un errore interno, il logout completa comunque e naviga a `/login`.

     Il test di caratterizzazione di T1 resta verde. Si aggiorna solo il mock perché includa il nuovo modulo.
- Verifica: `cd web && npx vitest run src/auth/AuthContext.test.tsx`, verde; `cd web && npm test`, suite verde.

### [ ] T11. Campione di campanella e audio che si mixa con la musica

- Copre: C7 (parte audio), C13 (preparazione), C15, R9, R10
- File: `web/scripts/make-bell.mjs` (nuovo), `web/public/sounds/rest-bell.wav` (nuovo, generato e committato), `web/vite.config.ts` (modifica), `web/src/lib/restTimer.ts` (modifica), `web/src/lib/restTimer.test.ts` (modifica)
- Passi:
  1. `make-bell.mjs` è Node senza dipendenze e deterministico. Scrive un WAV PCM 16 bit mono a 22050 Hz, lungo circa 1,6 s, con due rintocchi a circa 0 s e 0,45 s. Ogni rintocco è una somma di parziali inarmoniche con decadimento esponenziale: fondamentale intorno a 1320 Hz, rapporti circa 1 / 2 / 2,76 / 5,4, tutte sotto la Nyquist. L'attacco è di 2 ms e il picco è normalizzato a -1 dBFS. Il suono è creato da noi, senza licenze di terzi: indicarlo in un commento in testa allo script. Eseguirlo e committare il file.
  2. In `vite.config.ts` aggiungere `wav` ai `globPatterns`: `"**/*.{js,css,html,png,webp,svg,ico,wav}"`. Così `sounds/rest-bell.wav` entra nel precache, sotto il limite di 2 MB di workbox.
  3. In `restTimer.ts`, lasciando invariati `clockOffsetMs` e `remainingSeconds`:
     - `unlockAudio()`: prima di creare l'`AudioContext`, se esiste `navigator.audioSession` (Safari 17+), impostare `navigator.audioSession.type = "ambient"`, la modalità che per la spec W3C si mixa con altro audio. Aggiungere un tipo locale minimo, perché la lib DOM di TS non lo include. Dopo la creazione avviare una sola volta il caricamento del campione: `fetch("/sounds/rest-bell.wav")`, `arrayBuffer`, `decodeAudioData`, con il buffer tenuto in una variabile di modulo. Il `resume` resta com'è.
     - Aggiungere `resumeAudio()`, che fa `resume()` se il contesto esiste e il suo `state` non è `"running"` (copre `"suspended"` e `"interrupted"` di Safari).
     - Aggiungere `installAudioResume(): () => void`, che registra `resumeAudio` su `visibilitychange` (solo quando `document.visibilityState === "visible"`) e su `pageshow`, e restituisce il cleanup.
     - `beep()` mantiene il nome, così i test esistenti che lo mockano restano invariati, ma ora suona la campanella. Prima chiama `resumeAudio()`. Poi, se il buffer è pronto, suona un `AudioBufferSourceNode` con un `GainNode` a 1. Altrimenti ripiega sui due toni a 880 Hz di oggi. Senza contesto non fa nulla. Aggiornare il docstring.
     - `vibrate()` resta com'è.
  4. In `restTimer.test.ts` lasciare invariati i due test sulla matematica e aggiungere test audio. Per azzerare lo stato di modulo usare `vi.resetModules()` e un `import()` dinamico. Stubbare `window.AudioContext` con una classe finta (`state`, `resume`, `decodeAudioData`, `createBufferSource`, `createGain`, `createOscillator`, `destination`, `currentTime`) e `fetch`. Casi:
     - `unlockAudio` imposta `navigator.audioSession.type` a `"ambient"` prima di costruire il contesto;
     - senza `audioSession` non lancia;
     - `beep()` prima di `unlockAudio` non fa nulla;
     - dopo il caricamento del buffer, `beep()` avvia un buffer source;
     - senza buffer usa gli oscillatori;
     - `installAudioResume` chiama `resume` su `visibilitychange` se lo stato è `"interrupted"`, e non lo fa dopo il cleanup.
- Verifica:
  - `node web/scripts/make-bell.mjs`: crea `web/public/sounds/rest-bell.wav` di circa 70 KB con header `RIFF`/`WAVE`;
  - `cd web && npx vitest run src/lib/restTimer.test.ts src/components/gym/RestTimerBar.test.tsx`: verdi;
  - `cd web && npm run build`: senza errori;
  - `grep -c "sounds/rest-bell.wav" web/dist/sw.js`: almeno 1;
  - `cd web && npm test`: suite verde.

### [ ] T12. Regola dei 5 secondi in `RestTimerBar` e ripresa audio nella sessione live

- Copre: C7, C15, C16, C17, C21
- File: `web/src/components/gym/RestTimerBar.tsx` (modifica), `web/src/components/gym/RestTimerBar.test.tsx` (modifica), `web/src/pages/gym/WorkoutPage.tsx` (modifica)
- Passi:
  1. In `RestTimerBar.tsx` aggiungere `const LATE_ALERT_MS = 5000`. Nell'effect, quando `remaining` è 0, `seenRunning.current === endsAt` e `fired.current !== endsAt`, impostare `fired.current = endsAt`. Poi calcolare `late = Date.now() + offset - Date.parse(endsAt)` e chiamare `beep()` e `vibrate()` solo se `late <= LATE_ALERT_MS`. Aggiungere `offset` alle dipendenze. Il calcolo del countdown e il markup non cambiano. Aggiornare il commento del componente.
  2. In `WorkoutPage.tsx` aggiungere `useEffect(() => installAudioResume(), [])` insieme agli altri hook, prima dei `return` anticipati. `onPointerDown={unlockAudio}` e lo `style` dell'header con `viewportTop` non cambiano.
  3. In `RestTimerBar.test.tsx` lasciare invariati i test esistenti e quelli di T1, e aggiungere il caso C7 "ritorno dal background": render con riposo a +5 s e un tick a +2 s (visto in corso). Poi `vi.setSystemTime(NOW + 60_000)` e `act(() => vi.advanceTimersByTime(250))`. Risultato: barra assente e `beep` mai chiamato. Aggiungere anche il caso limite in cui lo zero è osservato a +4 s dalla scadenza: `beep` chiamato una volta.
- Verifica:
  - `cd web && npx vitest run src/components/gym/RestTimerBar.test.tsx src/pages/gym/WorkoutPage.test.tsx src/lib/restTimer.test.ts src/lib/useVisualViewportTop.test.ts`: tutti verdi, compresi i test del fix `timer-riposo-scompare-scroll` (C17);
  - `cd web && npm test`: suite verde (C21);
  - `cd web && npx tsc -b`: nessun errore.

### [ ] T13. Deploy remoto: chiavi VAPID, migrazione e suite pytest completa

- Copre: C3, C4, C5, C6, C22 (esecuzione reale sul DB)
- File: Nessuno (a parte eventuali correzioni ai test o al codice API emerse dall'esecuzione, da riportare nel registro)
- Passi:
  1. Push di `feature/campanella-fine-riposo` su `origin` (Gitea).
  2. Sul server:
     - `git pull origin feature/campanella-fine-riposo`;
     - generare le chiavi con `python api/scripts/gen_vapid_keys.py` e aggiungere `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT=mailto:...` al `.env`;
     - `docker compose up -d --build`;
     - `docker compose exec api alembic upgrade head`, su un DB che ha allenamenti in corso e finiti.
  3. Sul server eseguire la suite pytest completa dell'API, con il comando e l'ambiente che l'utente usa di solito per i test con DB. Eseguire anche `pytest tests/test_push_models.py tests/test_push_router.py tests/test_rest_notifier.py tests/test_rest_notifier_race.py -v`.
  4. Controllare nei log dell'API che il loop sia partito (log di `RestNotifier.start`) e che non ci siano eccezioni ripetute.
- Verifica, sul server:
  - `alembic upgrade head`: termina senza errori; `alembic current` mostra `e3f9b2a7c514`;
  - pytest: tutti i test passano, vecchi e nuovi;
  - `GET /api/push/config` da browser loggato: restituisce la chiave pubblica.

### [ ] T14. Verifica manuale su iPhone (checklist)

- Copre: C10, C11, C12, C13, C14 (più conferme sul dispositivo per C16, C18, C19)
- File: Nessuno
- Passi. Su iPhone con iOS 26, con la PWA installata in Home e aggiornata (chiuderla dallo switcher e riaprirla, come da README), gli auricolari collegati e la musica in riproduzione:
  1. In Impostazioni attivare "Avviso fine riposo", concedere il permesso e verificare il toggle attivo e il testo sul Focus. Aprire e chiudere Impostazioni: il toggle resta attivo (R3).
  2. C10: avviare un allenamento chiamato per esempio "Push A" e un riposo di 30 s, poi bloccare il telefono. Alla scadenza arriva "Riposo finito · Push A" con il suono di sistema entro circa 2 s. Ripetere passando a Spotify e poi a una chat durante il riposo. Ogni notifica suona, e nel Centro notifiche resta solo l'ultima; se si accumulano, annotarlo (fallback accettato).
  3. C11: toccare la notifica. YFP si apre sulla sessione live `/gym/workout`.
  4. C12: con il Focus palestra attivo e YFP tra le app consentite, la notifica arriva e suona. Togliere YFP dalle consentite: la notifica è silenziata.
  5. C13: con YFP in primo piano, a fine riposo la campanella si sente sopra la musica e la musica non si ferma. Ripetere spegnendo e riaccendendo lo schermo durante il riposo. Ripetere con la modalità silenziosa attiva. Se la campanella è muta solo in modalità silenziosa, annotarlo: con `"ambient"` iOS può silenziarla, e la scelta di un'altra modalità va decisa (vedi Domande aperte). Tornando in YFP più di 5 s dopo la scadenza, la campanella non suona.
  6. C14: premere `Salta` durante un riposo, poi in un altro riposo premere `-15s` fino a chiuderlo: nessuna notifica. Con `+15s` la notifica arriva alla nuova scadenza, una volta sola.
  7. Controlli su C16, C18 e C19:
     - il countdown è corretto dopo lo sleep dello schermo e dopo un reload;
     - con un secondo utente senza toggle non ci sono richieste di permesso né notifiche;
     - la PWA si apre offline;
     - dopo il logout il toggle risulta spento e al successivo riposo il dispositivo non riceve notifiche.
- Verifica: manuale. Risultato atteso: tutti i punti della checklist confermati dall'utente e annotati nel registro. Se C13 fallisce, si riapre la diagnosi audio senza bloccare la parte push, come da Rischi della spec.

## Domande aperte

Nessuna è bloccante.

1. **Modalità di `navigator.audioSession`.** Il piano usa `"ambient"`, che per la spec W3C si mixa con altro audio. In WebKit però corrisponde alla categoria Ambient di iOS, che la modalità silenziosa può silenziare. `"playback"` suona anche in silenzioso ma interrompe la musica. Si decide dopo C13 sul dispositivo.

Decisioni prese con l'utente (2026-09-30):

- Endpoint push: solo gli host dei push service noti (allowlist in T4).
- Notifiche: niente `tag`; il service worker chiude le notifiche precedenti prima di mostrare la nuova, così ogni avviso suona e nel Centro notifiche ne resta una (T7).
- Comando pytest sul server: resta generico in T13 ("come di solito").

## Registro di esecuzione

Commit di partenza: 5dd8c3f
- T1 — DONE — review: 1 round — commit: 3c89f03 — minor: vi.clearAllMocks() aggiunto al beforeEach esistente; test rest_ends_at null debole (nessun avanzamento timer)
- T2 — DONE — review: 1 round — commit: 8781ef2 — note: pip install bloccato per l'agent, eseguito dall'utente; minor: push_enabled non fa strip()
- T3 — DONE — review: 1 round — commit: a435702 — test DB non eseguiti in locale (T13); minor: UPDATE migrazione marca anche workout non in_progress (innocuo)
- T4 — DONE — review: 2 round (BLOCKER bypass allowlist con backslash, MAJOR test /config senza utente: corretti) — commit: 4c1a19a — minor: endpoint non normalizzato (case host, :443), a..notify.windows.com accettato (innocuo)
- T5 — DONE — review: 1 round + correzione minor sui test (race deterministico, pulizia utente, filtro per utente, log unico) — commit: 3f8100c — minor: fixture clock duplicata da test_workouts_live.py
