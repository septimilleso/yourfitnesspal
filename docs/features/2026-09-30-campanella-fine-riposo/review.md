# Review: Campanella a fine riposo

- Data: 2026-10-01
- Verdetto: APPROVED (sul codice; resta da eseguire la suite pytest con DB sul server)
- Diff: `5dd8c3f..2c2fc6b` (feature già mergiata su `main`, include il fix post-merge sulla validazione di `VAPID_SUBJECT`)
- Reviewer: devflow-reviewer (sonnet/high)

## Criteri di accettazione

| Criterio | Esito | Note |
|---|---|---|
| C1 | OK | `RestAlertSetting`, `SettingsPage`: toggle e testo Focus con `workouts.use`, assente senza permesso, disabilitato senza `PushManager`. Test verdi |
| C2 | OK | Attiva/disattiva; con permesso negato nessuna chiamata al server. `RestAlertSetting.test`, `push.test` verdi |
| C3 | NON VERIFICABILE in locale | Test presenti (upsert, delete solo propria, 403 senza CSRF, 410 rimossa) ma richiedono DB |
| C4 | NON VERIFICABILE in locale | `test_notifies_each_subscription_once` presente; logica corretta in lettura |
| C5 | NON VERIFICABILE in locale | Test presenti per skip, delta, finish, delete, scaduto da più di 60 s |
| C6 | NON VERIFICABILE in locale | `test_rest_notifier_race` presente |
| C7 | OK | `RestTimerBar`: una volta, non se non visto, non oltre 5 s di ritardo. Test verdi |
| C8 | OK | Ordine unsubscribe prima di `logout()` e cache verificato in `AuthContext.test` |
| C9 | OK | Build eseguita: `dist/push-sw.js` con `push` e `notificationclick`, `importScripts` in `dist/sw.js` |
| C10-C14 | Dichiarato dall'utente | Checklist iPhone eseguita dall'utente ("funziona tutto"); esiti puntuali non registrati |
| C15 | OK | Test timer esistenti invariati; `test_workouts_live` raccolto ma non eseguito (DB) |
| C16 | OK | Calcolo da `rest_ends_at`/`server_now` invariato; conferma su dispositivo dichiarata dall'utente |
| C17 | OK | `useVisualViewportTop` e `style` dell'header invariati, test verdi |
| C18 | OK | `requestPermission` solo in `enableRestAlerts`; test sul solo render |
| C19 | OK | `navigateFallbackDenylist`, `runtimeCaching`, `registerType`, `clearClientCaches` invariati, verificato su `dist/sw.js` |
| C20 | OK | Account e Gestione utenti invariati, test verdi |
| C21 | OK | `npm test` 267/267 |
| C22 | PARZIALE | Migrazione applicata sul server (riferito dall'utente); suite pytest completa non eseguita |

## Test

- `cd web && npm test`: 46 file, 267 test passati, 0 falliti.
- `cd web && npm run build`: ok.
- `cd api && ruff check .`: nessun errore. `import app.main`: ok. `pytest --collect-only`: 283 test raccolti.
- `pytest tests/test_config.py tests/test_push_sender.py tests/test_rest_notifier_loop.py`: 15 passati (test senza DB).
- Non eseguiti in locale (manca Postgres): `test_push_models`, `test_push_router`, `test_rest_notifier`, `test_rest_notifier_race`, `test_workouts_live`, `test_workouts_finish`, migrazione e `UPDATE` del claim su Postgres.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- Nessuno

### MINOR
- `api/app/services/rest_notifier.py:131,142,148` — Con VAPID presente ma invalido il notifier si disattiva con `logger.info`; il messaggio si vede solo perché una dipendenza porta il root logger a INFO. Usare `logger.warning` per chiave o subject invalidi; "incomplete" può restare `info`.
- `api/app/services/rest_notifier.py:147-148` — Il ramo "invalid VAPID private key" non ha test. Aggiungere un test locale con `vapid_private_key="garbage"` (`Vapid.from_string` solleva `ValueError`).
- `api/app/services/rest_notifier.py:67-111` — La sessione DB resta aperta durante gli invii (timeout 5 s). Innocuo con un solo utente; eventualmente chiudere la sessione prima del `gather`.
- `web/src/components/RestAlertSetting.tsx:43-54` — Con avviso attivo e permesso poi "denied", il toggle è disabilitato e la subscription resta sul server fino al logout. Già annotato (T9), nessuna azione.
- `docs/features/2026-09-30-campanella-fine-riposo/plan.md` — T13/T14 non chiusi e Domanda aperta 1 (`"ambient"` o `"playback"`) senza decisione scritta. Annotare esito e chiudere dopo il pytest sul server.
- `.env.example:15` — Il commento indica `python api/scripts/gen_vapid_keys.py` sull'host; allinearlo al README (`docker compose exec -T api python - < api/scripts/gen_vapid_keys.py`).

## Note

- Sicurezza verificata: la chiave privata non esce mai (`/config` restituisce solo la pubblica e solo se `push_enabled`); allowlist degli endpoint robusta (rifiutati suffissi, userinfo, backslash, caratteri di controllo, porta diversa da 443); router push sotto `get_current_user`, CSRF sulle scritture, `unsubscribe` filtrato per `user_id`.
- Claim atomico (`UPDATE ... RETURNING`, `IS DISTINCT FROM`, finestra 60 s); un solo allenamento in corso per utente garantito da `ux_workouts_one_in_progress`.
- Migrazione `e3f9b2a7c514` coerente con il modello, downgrade incluso.
- Nessuna rottura non dichiarata rispetto a "Impatto sull'esistente". File fuori piano: solo `@types/node` e lockfile (T7).
- Durante il deploy un `VAPID_SUBJECT` malformato faceva partire il notifier e fallire ogni invio; corretto nel `.env` e reso visibile all'avvio dal fix 2c2fc6b.
- Follow-up: eseguire la suite pytest completa sul server per chiudere C3-C6 e C22.
