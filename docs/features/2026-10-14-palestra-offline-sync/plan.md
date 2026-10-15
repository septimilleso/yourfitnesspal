# Piano: Palestra offline nell'IPA con stato locale e sync a blocco

- Data: 2026-10-14
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: feature
- Branch: `feature/palestra-offline-sync`

## Approccio

Tre parti in ordine. **Server** (`api/`): migrazione `uuid`/`version`, regole pure in `api/app/services/gym_rules.py` con fixture condivise, poi `PUT /api/workouts/{uuid}`, conflitti, plausibilità degli orari e snapshot. **Client-core** (`web/src/lib`, `web/src/native`): porting puro delle regole, reducer della sessione, store su file, motore di sync, adozione, conflitti, auth, notifiche, precarico. **UI**: un'astrazione di sessione condivisa da web e IPA, poi sessione locale, selettore, Termina, Annulla, Storico, badge, dialogo 409. Si riusano `previous_sets`/`best_sets`/`workout_out` (server), `normalizeSupersets`/`formatSet` di `web/src/lib/gym.ts`, `clockOffsetMs`/`remainingSeconds` di `web/src/lib/restTimer.ts`, `connectivity.ts`, il client HTTP (`ApiError` porta il corpo, quindi il 409 arriva con `current`) e il pattern di scrittura di `queryPersistence.ts`.

Decisioni di design (valgono per tutti i task):

- **Versione sul server.** `_save` in `api/app/services/workouts.py` incrementa `version` solo per un allenamento già persistente (la creazione parte da 1); `save_as_template` la incrementa a mano. Il notifier usa un `UPDATE` diretto e non la tocca.
- **Errore 409.** Nuovo `Conflict(ServiceError)` in `api/app/services/errors.py` con `reason` e `current` (`WorkoutOut | None`), mappato in `api/app/main.py` a 409 con corpo `{"detail": reason, "current": ...}`. Lo usa anche il controllo di versione di `DELETE`.
- **Annulla offline di un allenamento sincronizzato (R20, C53).** `DELETE /api/workouts/{id}` accetta un parametro di query opzionale `base_version`: se presente e diverso dalla versione del server risponde 409 `version_conflict`. Senza parametro il comportamento resta quello di oggi. Così il controllo è atomico sul server, senza una lettura preventiva.
- **Regole pure lato server.** In `gym_rules.py` si aggiungono dataclass di stato (`StateWorkout`, `StateExercise`, `StateSet`) e funzioni pure: prefill di aggiungi serie e aggiungi esercizio, reset per cambio di tracking, azioni sul riposo, regole di fine, normalizzazione canonica, confronto di contenuto, limiti degli orari. Gli endpoint granulari esistenti le usano senza cambiare comportamento.
- **Fixture condivise.** `api/tests/fixtures/gym_parity.json`, un elenco di casi `{"fn", "name", "input", "expected"}` con orari ISO e un `now` esplicito. Pytest le legge con `pathlib`; Vitest con `readFileSync(resolve(process.cwd(), "../api/tests/fixtures/gym_parity.json"))`, come fa già `web/src/lib/art.test.ts` con `node:fs`. Stanno sotto `api/` perché il container dei test remoti monta solo `api/`.
- **Moduli client.**
  - `web/src/lib/gymRules.ts`: porting puro delle regole;
  - `web/src/lib/gymSession.ts`: tipi della sessione e reducer puro, con `now` (ms sull'orologio del server stimato) e generatore di UUID (`crypto.randomUUID`) iniettati;
  - `web/src/native/gymStore.ts`: stato in memoria, `subscribe`/`getSnapshot` per `useSyncExternalStore`, file `yfp/gym-local.json`; importa solo `@capacitor/filesystem`, `gymSession` e `platform`, mai `api/client.ts`, per non allungare il ciclo `client.ts` → `queryPersistence.ts` → `api/gym.ts`;
  - `web/src/native/gymSync.ts`: `PUT`, applicazione delle risposte, trigger, adozione, conflitti; importa `api/gym.ts` e lo store.
- **Forma dello store (schema 1).** `{ schema, userId, clockOffsetMs, active: Entry | null, finished: Entry[], pendingDeletes: PendingDelete[], templateProposals: number[] }`. Ogni `Entry` contiene:
  - `workout`, cioè la sessione con uuid, e `id` nullo finché il server non l'ha visto;
  - `baseVersion`, `revision` (contatore delle modifiche locali) e `sentRevision`;
  - `sync`: `pending`, `synced`, `conflict` o `error`;
  - `conflict` (`reason`, `current`) e `lastServer` (ultima `WorkoutOut`, per Precedente e Max).
- **Sessione condivisa web/IPA.** `WorkoutPage`, `WorkoutExerciseCard` e `SetRow` ricevono un oggetto `LiveSession` (operazioni per uuid) e una `SessionWorkout`. Sul web `useServerSession` traduce uuid → id e chiama `gymApi` con `useLiveMutation`, come oggi. Nell'IPA `useLocalSession` fa dispatch sullo store. Nei tipi web `uuid` e `version` sono opzionali e la chiave ricade su `String(id)` se `uuid` manca: i test esistenti restano invariati (C40).
- **Orologio.** Lo store salva `clockOffsetMs` da ogni risposta con `server_now`. Il reducer riceve `Date.now() + clockOffsetMs`. `RestTimerBar` e `syncRestNotification` ricevono un `offsetMs` esplicito, opzionale: senza, valgono le regole di oggi.
- **Riepilogo locale.** Nuova rotta `/gym/history/local/:uuid` (con `?summary=1` dopo Termina), resa da `web/src/pages/gym/LocalWorkoutDetailPage.tsx`.
- **Test API con DB.** Non c'è Postgres locale. In locale si eseguono `cd api && ruff check app tests && python -c "import app.main" && pytest --collect-only -q`, più i pytest DB-free. Sul remoto, dopo `git pull` e `docker compose build api`, si usa questo comando (di seguito "pytest sul remoto `<file>`"):
  `docker compose run --rm -T -e DATABASE_URL=postgresql+asyncpg://postgres:postgres@db:5432/yfp_test -v "$PWD/api:/app" api sh -c "pip install -q pytest pytest-asyncio respx && alembic upgrade head && pytest -q <file>"`

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### Server

### [x] T1. Migrazione `uuid` e `version`, versione incrementata dalle scritture

- Copre: C1, C2, C11, C41
- Rischio: alto
- File: `api/alembic/versions/f7b3c9d2e418_workout_sync.py` (nuovo, `down_revision = "c4d7a2f81b56"`), `api/app/models/workout.py` (modifica), `api/app/schemas/workout.py` (modifica), `api/app/services/workouts.py` (modifica), `api/tests/test_workouts_version.py` (nuovo)
- Passi:
  1. Migrazione: `uuid` UUID non nullo unico con `server_default gen_random_uuid()` su `workouts`, `workout_exercises`, `workout_sets`; `workouts.version` intero non nullo `server_default 1`. Downgrade che rimuove le colonne.
  2. Modelli con le colonne (`sa.Uuid`); `WorkoutOut` con `uuid`, `version`; `WorkoutExerciseOut` e `WorkoutSetOut` con `uuid`; `workout_out` li valorizza.
  3. `_save` incrementa `version` se l'allenamento è persistente; `save_as_template` la incrementa.
  4. Test: endpoint granulare → `version` + 1 e uuid stabile; `notify_due_rests` non cambia `version`; `start_workout` → `version = 1`.
- Verifica: in locale `cd api && ruff check app tests && python -c "import app.main" && pytest --collect-only -q tests/test_workouts_version.py` senza errori. Pytest sul remoto `tests/test_workouts_version.py tests/test_gym_routers.py tests/test_workouts_live.py tests/test_workouts_finish.py tests/test_rest_notifier.py`: tutti verdi. Sul remoto `alembic downgrade -1 && alembic upgrade head` sul DB `yfp_test` termina senza errori (C11).

### [x] T2. Fixture condivise per le regole esistenti

- Copre: C12
- Rischio: basso
- File: `api/tests/fixtures/gym_parity.json` (nuovo), `api/tests/test_gym_parity.py` (nuovo)
- Passi:
  1. Casi per `normalize_supersets`, `set_problem`, `rest_after_completion` (singolo, superserie a metà e a fine giro, riposo 0), `template_diff` (valori, serie +/-, riposo, aggiunto/rimosso, ordine/superserie), `format_set`, ricavati dai casi di `test_gym_rules.py`.
  2. `test_gym_parity.py` scorre la fixture, chiama la funzione indicata da `fn` e confronta con `expected`; un `fn` sconosciuto fa fallire il test.
- Verifica: `cd api && pytest -q tests/test_gym_rules.py tests/test_gym_parity.py`, risultato atteso: tutti verdi, in locale.

### [x] T3. Regole pure delle azioni live, usate dagli endpoint esistenti

- Copre: C12, C41
- Rischio: alto
- File: `api/app/services/gym_rules.py` (modifica), `api/app/services/workouts.py` (modifica), `api/tests/fixtures/gym_parity.json` (modifica), `api/tests/test_gym_parity.py` (modifica)
- Passi:
  1. Funzioni pure: `next_set_values` (copia dell'ultima, poi la prima di Precedente, poi vuota), `exercise_prefill` (serie e riposo da Precedente, altrimenti una vuota e 90 s), `tracking_reset` (serie non completate e campi non usati), `rest_action` (start/delta/skip con le regole di `rest`, errore "no rest timer running"), `finish_problem` e `finish_prune`.
  2. `add_set`, `add_exercise`, `patch_exercise`, `rest`, `finish_workout` le usano, senza cambiare risposte né messaggi.
  3. Casi nella fixture per ogni funzione.
- Verifica: `cd api && pytest -q tests/test_gym_rules.py tests/test_gym_parity.py` verde in locale. Pytest sul remoto `tests/test_workouts_live.py tests/test_workouts_finish.py tests/test_gym_routers.py`: verdi, invariati.

### [x] T4. Normalizzazione canonica, confronto di contenuto e limiti degli orari

- Copre: C12
- Rischio: alto
- File: `api/app/services/gym_rules.py` (modifica), `api/tests/fixtures/gym_parity.json` (modifica), `api/tests/test_gym_parity.py` (modifica)
- Passi:
  1. Dataclass `StateWorkout`/`StateExercise`/`StateSet` e `canonical_workout(state)`: posizioni dall'ordine, `normalize_supersets`, con `finished` scarto delle non completate e degli esercizi vuoti e riposo azzerato.
  2. `same_content(a, b)`: confronto dopo la normalizzazione, con decimali normalizzati come `_norm`.
  3. `clamp_times(state, now)`: regole di R6 con T = 5 min; `rest_ends_at`/`rest_total_s` coerenti.
  4. Casi nella fixture, compresi orari nel futuro, `completed_at` prima dell'inizio e riposo oltre 600 s.
- Verifica: `cd api && pytest -q tests/test_gym_parity.py` verde in locale.

### [x] T5. `PUT /api/workouts/{uuid}`: creazione e aggiornamento

- Copre: C3, C4, C5, C42, C43
- Rischio: alto
- File: `api/app/schemas/workout.py` (modifica: `WorkoutPutIn`, `WorkoutPutExercise`, `WorkoutPutSet` con i limiti di R3), `api/app/services/workouts.py` (modifica: `put_workout`), `api/app/routers/workouts.py` (modifica), `api/tests/test_workouts_sync.py` (nuovo)
- Passi:
  1. `put_workout(db, user, uuid, payload) -> (WorkoutOut, created)`: se l'uuid non esiste e `base_version` è null crea l'allenamento; se `base_version` è uguale alla versione aggiorna. Abbinamento per uuid: le righe abbinate mantengono l'id, le nuove si creano, le assenti si eliminano. Esercizi visibili via `get_visible_exercises`; `template_id` non posseduto → null; `set_problem` sulle completate → `Invalid`; `canonical_workout`; `empty_workout`; `last_used_at` del modello alla creazione.
  2. Rotta `PUT /{workout_uuid}` (tipo `UUID`): 201 alla creazione, 200 all'aggiornamento.
  3. Test di C3, C4, C5 e C43 (`previous`/`max_set` identici a un allenamento avviato con `POST /workouts`).
- Verifica: locale `ruff` + `import app.main` + `pytest --collect-only -q tests/test_workouts_sync.py`. Pytest sul remoto `tests/test_workouts_sync.py tests/test_gym_routers.py`: verdi (C42 è il test esistente su `POST /workouts` con un allenamento attivo).

### [x] T6. Conflitti 409, idempotenza e `DELETE` con `base_version`

- Copre: C6, C7, C8, C53
- Rischio: alto
- File: `api/app/services/errors.py` (modifica: `Conflict`), `api/app/main.py` (modifica: handler 409), `api/app/services/workouts.py` (modifica), `api/app/routers/workouts.py` (modifica: `base_version` opzionale su `DELETE`), `api/tests/test_workouts_sync.py` (modifica)
- Passi:
  1. In `put_workout`: `same_content` con lo stato del server → 200 senza incremento; versione diversa, uuid sparito con `base_version` non nulla, server già `finished` con contenuto diverso → `Conflict("version_conflict", current)`; altro `in_progress` per l'utente (controllo prima, `IntegrityError` dopo) → `Conflict("other_active", current)`; uuid di un altro utente → `NotFound`.
  2. `delete_workout(..., base_version=None)`: con `base_version` diverso dalla versione → `Conflict("version_conflict", current)`.
  3. Test di C6, C7, C8 e del `DELETE` con versione giusta (204), sbagliata (409) e senza parametro (204 come oggi).
- Verifica: pytest sul remoto `tests/test_workouts_sync.py tests/test_gym_routers.py`: verdi.

### [x] T7. Limiti degli orari nel `PUT` e niente push tardive

- Copre: C9, C45
- Rischio: alto
- File: `api/app/services/workouts.py` (modifica), `api/tests/test_workouts_sync.py` (modifica)
- Passi:
  1. `put_workout` applica `clamp_times` con `now()` prima di salvare.
  2. Se `rest_ends_at <= now()`, imposta `rest_notified_at = rest_ends_at`.
  3. Test di C9: orari nel futuro e `completed_at` precedente; riposo scaduto da 10 s e `notify_due_rests` con un sender finto che non viene chiamato.
- Verifica: pytest sul remoto `tests/test_workouts_sync.py tests/test_rest_notifier.py tests/test_rest_notifier_race.py`: verdi.

### [x] T8. Endpoint `GET /api/workouts/offline-snapshot`

- Copre: C10
- Rischio: alto
- File: `api/app/schemas/workout.py` (modifica: `OfflineSnapshot`, `SnapshotExercise`), `api/app/services/workouts.py` (modifica: `offline_snapshot`), `api/app/routers/workouts.py` (modifica: rotta prima di `/{workout_id}`), `api/tests/test_workouts_snapshot.py` (nuovo)
- Passi:
  1. Insieme degli esercizi: quelli dei modelli dell'utente, quelli degli allenamenti finiti negli ultimi 90 giorni e quelli dell'attivo.
  2. Per ognuno: `exercise_out`, `rest_seconds` da `previous_sets` (o null), `previous` e `max` da `previous_sets`/`best_sets`; più `server_now`.
  3. Test di C10, isolamento per utente e 403 senza permesso.
- Verifica: pytest sul remoto `tests/test_workouts_snapshot.py`: verde.

### Client-core

### [x] T9. Tipi e chiamate API per sync e snapshot

- Copre: C38 (preparazione)
- Rischio: basso
- File: `web/src/api/gym.ts` (modifica)
- Passi:
  1. Campi opzionali `uuid?` e `version?` su `Workout`, `WorkoutExercise`, `WorkoutSet`.
  2. Tipi `OfflineSnapshot`, `SnapshotExercise`, `WorkoutPutBody`, `ConflictBody`.
  3. `gymKeys.offlineSnapshot = ["gym","offline-snapshot"]`, `fetchOfflineSnapshot()`, `putWorkout(uuid, body)`, `deleteWorkoutChecked(id, baseVersion)`. Solo aggiunte, nessun uso ancora.
- Verifica: `cd web && npm test && npm run build`, risultato atteso: tutti verdi, build senza errori.

### [x] T10. Porting puro delle regole e test di parità in Vitest

- Copre: C13
- Rischio: alto
- File: `web/src/lib/gymRules.ts` (nuovo), `web/src/lib/gymRules.parity.test.ts` (nuovo)
- Passi:
  1. `setProblem`, `restAfterCompletion`, `templateDiff` (stesse stringhe), `formatSetText` (riuso di `formatSet`), più le funzioni di T3 e T4 (`nextSetValues`, `exercisePrefill`, `trackingReset`, `restAction`, `finishProblem`, `finishPrune`, `canonicalWorkout`). `normalizeSupersets` viene da `web/src/lib/gym.ts`.
  2. Il test legge `../api/tests/fixtures/gym_parity.json` e fa girare ogni caso; un `fn` senza implementazione TS fa fallire il test.
- Verifica: `cd web && npx vitest run src/lib/gymRules.parity.test.ts`, risultato atteso: un test per caso, tutti verdi; `npm test` verde.

### [x] T11. Reducer della sessione: serie e riposo

- Copre: C18, C19, C23 (logica dell'orologio)
- Rischio: alto
- File: `web/src/lib/gymSession.ts` (nuovo), `web/src/lib/gymSession.sets.test.ts` (nuovo)
- Passi:
  1. Tipi `SessionWorkout`/`SessionExercise`/`SessionSet` (uuid, `id: number | null`) e `reduceSession(state, action, { now, uuid })`.
  2. Azioni: `patchSet`, `completeSet` (valori, `setProblem`, `restAfterCompletion`), `uncompleteSet`, `addSet`, `deleteSet` (rinumerazione), `restStart`/`restDelta`/`restSkip`.
  3. Un'azione non valida restituisce un errore con il messaggio del server, che `liveErrorMessage` traduce, e lo stato invariato.
  4. Test: superserie A+B (C18), ✓ senza kg (C19), riposo dall'orario iniettato.
- Verifica: `cd web && npx vitest run src/lib/gymSession.sets.test.ts` verde; `npm test` verde.

### [x] T12. Reducer della sessione: avvio, esercizi, layout, fine, Precedente e Max

- Copre: C21, C31 (logica), C33 (logica)
- Rischio: alto
- File: `web/src/lib/gymSession.ts` (modifica), `web/src/lib/gymSession.workout.test.ts` (nuovo)
- Passi:
  1. `startEmpty` (nome "Allenamento GG/MM/AAAA") e `startFromTemplate(template)`.
  2. `addExercises(exercises, snapshot)` con `exercisePrefill`, `replaceExercise` con `trackingReset`, `setRest`, `setNote`, `setLayout`, `removeExercise`, `rename`.
  3. `finish(discardIncomplete)` con `finishProblem`/`finishPrune`.
  4. Selettore `previousAndMax(entry, snapshot)` per R13: prima `lastServer` per uuid, poi lo snapshot per posizione.
  5. Test di C21 (logica) e delle regole di fine.
- Verifica: `cd web && npx vitest run src/lib/gymSession.workout.test.ts` verde; `npm test` verde.

### [x] T13. Store locale su file

- Copre: C14, C15, C16, C47
- Rischio: alto
- File: `web/src/native/gymStore.ts` (nuovo), `web/src/native/gymStore.test.ts` (nuovo), `web/src/native/boot.ts` (modifica)
- Passi:
  1. Stato in memoria con `subscribe`/`getSnapshot` e `dispatch(uuid, action)`, che passa da `reduceSession` e incrementa `revision`.
  2. Scrittura atomica (`yfp/gym-local.tmp.json` poi `Filesystem.rename` su `yfp/gym-local.json`), in coda, 1 s dopo l'ultima modifica e subito su `visibilitychange` → `hidden`.
  3. `loadGymStore()` in `prepareNativeSession` dopo `loadNativeSession`, indipendente dal buster: un JSON non valido viene rinominato in `yfp/gym-local.corrupt-<ms>.json` e lo store parte vuoto.
  4. `clearGymStore()` per il logout. Nel browser tutte le funzioni sono no-op.
- Verifica: `cd web && npx vitest run src/native/gymStore.test.ts src/native/queryPersistence.test.ts src/native/boot.test.ts`, risultato atteso: verdi (C47 con i test esistenti invariati); `npm test` verde.

### [x] T14. Sync: invio del `PUT` e applicazione della risposta

- Copre: C24 (applicazione), C26, C27
- Rischio: alto
- File: `web/src/native/gymSync.ts` (nuovo), `web/src/native/gymSync.test.ts` (nuovo)
- Passi:
  1. `syncEntry(uuid, queryClient)`: corpo da `entry.workout` e `baseVersion`, `sentRevision = revision`, chiamata a `putWorkout`.
  2. Con 200/201: se `revision === sentRevision` lo stato diventa la risposta, altrimenti si aggiornano solo `baseVersion`, gli id, `lastServer` e `clockOffsetMs` e la voce resta `pending`.
  3. Un finito confermato esce dallo store: `setQueryData(gymKeys.workout(id))` e invalidazione di `["gym","history"]`, `["gym","stats"]`, `["gym","templates"]` e dello snapshot.
  4. 409 → `conflict` con `reason`/`current`; altri 4xx → `error`; 5xx e `NetworkError` → resta `pending`; 401 → nessuna modifica allo store.
- Verifica: `cd web && npx vitest run src/native/gymSync.test.ts`, risultato atteso: casi di C24 (modifica durante il volo → secondo invio con la nuova `baseVersion`), C26, C27 verdi.

### [x] T15. Sync: trigger, coalescing e ordine

- Copre: C24, C25
- Rischio: alto
- File: `web/src/native/gymSync.ts` (modifica), `web/src/native/gymSyncScheduler.test.ts` (nuovo), `web/src/native/NativeOfflineServices.tsx` (modifica)
- Passi:
  1. `startGymSync(queryClient)`: modifiche dello store raggruppate con 1 s di quiete, `subscribeConnectivity` al ritorno online, `visibilitychange` → `visible`, avvio con token.
  2. Al più un `PUT` in volo per uuid; prima i finiti in ordine di `finished_at`, poi l'attivo; voci `conflict` saltate, voci `error` ritentate solo in primo piano o all'apertura.
  3. `syncNow(uuid, timeoutMs)` restituisce l'esito o `timeout`.
  4. Avvio da `NativeOfflineServices`; nessun legame con il throttle del precarico.
- Verifica: `cd web && npx vitest run src/native/gymSyncScheduler.test.ts src/native/NativeOfflineServices.test.tsx`, risultato atteso: cinque modifiche in 500 ms → un `PUT` (C25), rete di nuovo presente → un `PUT` con l'ultimo stato (C24); verdi.

### [x] T16. Adozione dell'allenamento attivo del server

- Copre: C28
- Rischio: alto
- File: `web/src/native/gymSync.ts` (modifica), `web/src/native/gymAdopt.test.ts` (nuovo)
- Passi:
  1. `adoptServerActive()` all'apertura e al ritorno in primo piano con rete, prima dei `PUT`: `GET /workouts/active` e regole di R17 (nessun locale → adotta; stesso uuid senza modifiche e versione più alta → adotta; modifiche in attesa → non adotta; nessun attivo sul server e locale sincronizzato senza modifiche → rimuove il locale).
  2. Aggiorna `clockOffsetMs`.
- Verifica: `cd web && npx vitest run src/native/gymAdopt.test.ts`, risultato atteso: C28 e i quattro rami di R17 verdi.

### [x] T17. Conflitti ed eliminazioni in attesa (logica)

- Copre: C29 (logica), C30 (logica), C33 (logica), C53 (logica)
- Rischio: alto
- File: `web/src/native/gymSync.ts` (modifica), `web/src/native/gymStore.ts` (modifica), `web/src/native/gymConflict.test.ts` (nuovo)
- Passi:
  1. `resolveConflict(uuid, "local" | "server")`. Locale con `version_conflict`: `baseVersion = current?.version ?? null` e nuovo `PUT`. Locale con `other_active`: `deleteWorkoutChecked(current.id)` senza versione e poi `PUT`. Server: lo store prende `current` (in corso → attivo, finito o null → voce rimossa).
  2. `cancelLocal(uuid)`: mai sincronizzato → rimozione; sincronizzato → rimozione e `pendingDeletes` con `id` e `baseVersion`.
  3. Il sync invia `deleteWorkoutChecked(id, baseVersion)`; un 409 riporta l'allenamento nello store in `conflict` con `current`.
- Verifica: `cd web && npx vitest run src/native/gymConflict.test.ts`, risultato atteso: C29, C30 (ordine `DELETE` poi `PUT`) e C53 (409 → conflitto, nessun altro `DELETE`) verdi.

### [x] T18. Logout, 401 e cambio utente

- Copre: C34
- Rischio: alto
- File: `web/src/auth/AuthContext.tsx` (modifica), `web/src/native/gymStore.ts` (modifica), `web/src/native/NativeOfflineServices.tsx` (modifica), `web/src/auth/AuthContext.gymLocal.native.test.tsx` (nuovo)
- Passi:
  1. Logout nell'IPA: se ci sono N voci non sincronizzate, `window.confirm("Ci sono N allenamenti non sincronizzati: uscendo andranno persi")`; annullando non succede nulla, confermando `clearGymStore()` e poi il flusso di oggi.
  2. Il 401 in `web/src/api/client.ts` resta com'è e non tocca lo store.
  3. Su risposta riuscita di `["me"]` con `id` diverso da `store.userId` lo store viene svuotato senza invii; con lo stesso id riparte il sync.
- Verifica: `cd web && npx vitest run src/auth`, risultato atteso: nuovi casi di C34 verdi, test esistenti di logout invariati.

### [x] T19. Notifiche di riposo dallo stato locale

- Copre: C23, C37, C46
- Rischio: alto
- File: `web/src/native/restNotifications.ts` (modifica: `offsetMs` opzionale), `web/src/native/NativeBridge.tsx` (modifica), `web/src/native/NativeBridge.test.tsx` (modifica), `web/src/native/restNotifications.test.ts` (modifica)
- Passi:
  1. `syncRestNotification(workout, offsetMs?)`: con `offsetMs` usa quello invece di `server_now`.
  2. Nell'IPA `NativeBridge` si iscrive allo store (attivo e `clockOffsetMs`) invece che a `["gym","workout","active"]`, e all'avvio ricostruisce la notifica dallo stato caricato.
  3. Il tocco sulla notifica naviga come oggi; logout e cancellazione come oggi.
- Verifica: `cd web && npx vitest run src/native/NativeBridge.test.tsx src/native/restNotifications.test.ts`, risultato atteso: C23 (scarto +60 s, riavvio dopo 30 s), C37 (riprogrammata 4101, cancellata se scaduta, nessuna con l'impostazione spenta) e C46 verdi.

### [x] T20. Snapshot nel giro di precarico

- Copre: C38, C48
- Rischio: alto
- File: `web/src/native/prefetch.ts` (modifica), `web/src/native/prefetch.test.ts` (modifica), `web/src/test/prefetchFixtures.ts` (modifica)
- Passi:
  1. Nei compiti palestra si aggiunge `load(gymKeys.offlineSnapshot, () => fetchOfflineSnapshot())`.
  2. La chiave non è nelle famiglie prunabili ed è persistita di default; il giro non importa `gymStore`.
  3. Test: snapshot in cache e nel file dopo il giro; nessun accesso a `["gym","workout","active"]` né allo store; senza `workouts.use` nessuna richiesta.
- Verifica: `cd web && npx vitest run src/native/prefetch.test.ts src/native/prefetch.errors.test.ts src/native/prefetchScheduler.test.ts src/native/cachePrune.test.ts`, risultato atteso: verdi (C48).

### UI

### [x] T21. Test di caratterizzazione della sessione web

- Copre: C40, C44
- Rischio: basso
- File: `web/src/components/gym/WorkoutExerciseCard.test.tsx` (nuovo), `web/src/components/gym/ActiveWorkoutBar.test.tsx` (nuovo), `web/src/pages/gym/WorkoutPage.actions.test.tsx` (nuovo), `web/src/pages/gym/GymStartPage.test.tsx` (modifica)
- Passi:
  1. Sul codice di oggi, nel browser: aggiungi serie, completa con valori, annulla completamento ed elimina serie chiamano gli endpoint con gli id giusti; aggiungi esercizio dal selettore; sposta su, collega e scollega (`PUT .../layout`); riposo dal picker; timer manuale; +15s e Salta; rinomina al blur; Annulla allenamento; Termina con conferma.
  2. Toast "Non salvato: controlla la connessione" su `NetworkError`.
  3. `ActiveWorkoutBar` con e senza allenamento; `GymStartPage` avvio vuoto e da modello, "Riprendi" con un attivo.
  4. Nessuna modifica al codice di produzione.
- Verifica: `cd web && npm test`, risultato atteso: i nuovi test passano sul codice attuale, tutti verdi.

### [x] T22. Astrazione `LiveSession` e implementazione server

- Copre: C40, C44
- Rischio: alto
- File: `web/src/lib/liveSession.ts` (nuovo), `web/src/api/serverSession.ts` (nuovo), `web/src/pages/gym/WorkoutPage.tsx`, `web/src/components/gym/WorkoutExerciseCard.tsx`, `web/src/components/gym/SetRow.tsx`, `web/src/components/gym/RestTimerBar.tsx` (modifica: `offsetMs` opzionale)
- Passi:
  1. Interfaccia `LiveSession` con le operazioni della sessione per uuid; `useServerSession(workout)` traduce uuid → id (con ripiego su `String(id)`) e usa `gymApi`/`useLiveMutation`/`useFinishWorkout`/`useCancelWorkout` come oggi.
  2. I componenti ricevono `session` e usano chiavi per uuid; nessun cambiamento visibile nel browser.
- Verifica: `cd web && npm test`, risultato atteso: i test di T21 e quelli esistenti (`WorkoutPage.test.tsx`, `SetRow.test.tsx`, `RestTimerBar*.test.tsx`, il caso web di `WorkoutPage.offline.test.tsx`) verdi senza modifiche.

### [x] T23. Sessione locale nell'IPA: pagina, barra, avvio

- Copre: C17, C18, C19, C20, C21
- Rischio: alto
- File: `web/src/native/localSession.ts` (nuovo: `useLocalSession`, `useActiveSession`), `web/src/pages/gym/WorkoutPage.tsx`, `web/src/components/gym/ActiveWorkoutBar.tsx`, `web/src/pages/gym/GymStartPage.tsx`, `web/src/components/gym/TemplatePreviewSheet.tsx` (modifica), `web/src/pages/gym/WorkoutPage.offline.test.tsx` (modifica dei soli casi nativi), `web/src/pages/gym/WorkoutPage.local.native.test.tsx` (nuovo)
- Passi:
  1. `useActiveSession()`: nell'IPA legge lo store (con `previousAndMax` e lo snapshot dalla cache), nel browser `useActiveWorkout` come oggi.
  2. `WorkoutPage` nell'IPA usa `useLocalSession`; il messaggio "Allenamento non disponibile offline" resta solo nel browser.
  3. `ActiveWorkoutBar` e "Riprendi" leggono lo stato locale; l'avvio da `GymStartPage` e dall'anteprima fa dispatch nello store. Senza dettaglio in cache e senza rete, l'anteprima mostra `OfflineUnavailable` e non avvia.
  4. Test nativi offline di C17–C21, con la verifica che nessuna richiesta parta durante le azioni.
- Verifica: `cd web && npx vitest run src/pages/gym` verde; `npm test` verde.

### [x] T24. Selettore esercizi offline

- Copre: C22
- Rischio: alto
- File: `web/src/components/gym/ExercisePicker.tsx` (modifica), `web/src/lib/localExercises.ts` (nuovo), `web/src/components/gym/ExercisePicker.offline.native.test.tsx` (nuovo)
- Passi:
  1. `localExercises(queryClient)`: unione senza duplicati della pagina del catalogo in cache, degli esercizi dello snapshot e di quelli dei modelli in cache; filtro per nome (case-insensitive), attrezzo e muscolo.
  2. Nell'IPA offline il selettore usa la lista locale; "+ Nuovo" mostra "Non disponibile offline". Con rete il selettore resta quello di oggi.
- Verifica: `cd web && npx vitest run src/components/gym` verde, compresi i test esistenti di `ExercisePicker.test.tsx`.

### [ ] T25. Termina nell'IPA e riepilogo locale

- Copre: C31, C32
- Rischio: alto
- File: `web/src/pages/gym/LocalWorkoutDetailPage.tsx` (nuovo), `web/src/App.tsx` (modifica: rotta `/gym/history/local/:uuid`), `web/src/pages/gym/WorkoutPage.tsx` (modifica), `web/src/pages/gym/LocalWorkoutDetailPage.test.tsx` (nuovo)
- Passi:
  1. Termina nell'IPA: regole locali di oggi (avviso, conferma), poi `syncNow(uuid, 5000)`. Se riesce, `navigate("/gym/history/{id}?summary=1")` come oggi; altrimenti `/gym/history/local/{uuid}?summary=1`.
  2. Riepilogo locale: nome, data, durata, serie, `templateDiff` col modello in cache e la riga "Potrai aggiornare il modello dopo la sincronizzazione". Quando lo store segnala la conferma del server, sostituisce la rotta con quella del server.
- Verifica: `cd web && npx vitest run src/pages/gym/LocalWorkoutDetailPage.test.tsx src/pages/gym/WorkoutPage.local.native.test.tsx`, risultato atteso: C31 e C32 verdi; `npm test` verde.

### [ ] T26. Proposta "Aggiorna modello" riproposta una volta

- Copre: C54
- Rischio: alto
- File: `web/src/native/gymStore.ts` (modifica: `templateProposals`), `web/src/pages/gym/LocalWorkoutDetailPage.tsx`, `web/src/pages/gym/WorkoutDetailPage.tsx` (modifica), `web/src/pages/gym/WorkoutDetailPage.proposal.native.test.tsx` (nuovo)
- Passi:
  1. Se il riepilogo locale si chiude prima del sync, l'uuid viene segnato; alla conferma diventa l'id del server in `templateProposals`.
  2. `WorkoutDetailPage` nell'IPA, fuori da `summary`, mostra il riquadro delle modifiche se l'id è in `templateProposals` e `template_diff` non è vuoto, poi lo rimuove dall'elenco.
- Verifica: `cd web && npx vitest run src/pages/gym/WorkoutDetailPage.proposal.native.test.tsx src/pages/gym/WorkoutDetailPage.test.tsx`, risultato atteso: compare una volta e non alla riapertura; test esistenti invariati.

### [ ] T27. Annulla allenamento nell'IPA

- Copre: C33, C53
- Rischio: alto
- File: `web/src/native/localSession.ts` (modifica), `web/src/pages/gym/WorkoutPage.local.native.test.tsx` (modifica)
- Passi:
  1. Con rete e allenamento sincronizzato: `DELETE` come oggi, poi rimozione locale.
  2. In tutti gli altri casi: `cancelLocal(uuid)` di T17 e navigazione a `/gym`. La notifica viene cancellata (T19).
- Verifica: `cd web && npx vitest run src/pages/gym/WorkoutPage.local.native.test.tsx src/native/gymConflict.test.ts`, risultato atteso: C33 (nessuna richiesta al ritorno della rete) e C53 verdi.

### [ ] T28. Storico con gli allenamenti da sincronizzare

- Copre: C35, C49
- Rischio: alto
- File: `web/src/pages/gym/HistoryPage.tsx` (modifica), `web/src/pages/gym/LocalWorkoutDetailPage.tsx` (modifica: senza `summary`), `web/src/pages/gym/HistoryPage.local.native.test.tsx` (nuovo)
- Passi:
  1. Nell'IPA, sopra i gruppi per mese, le voci finite dello store con la card di oggi, l'etichetta "Da sincronizzare", "Conflitto" o "Errore di sincronizzazione", e il link a `/gym/history/local/{uuid}`, senza `SwipeableCard`.
  2. Le voci con un id già presente nelle pagine dello storico non si mostrano.
  3. Il dettaglio locale non ha `ActionMenu`.
- Verifica: `cd web && npx vitest run src/pages/gym/HistoryPage.local.native.test.tsx src/pages/gym/HistoryPage.test.tsx src/pages/gym/WorkoutDetailPage.test.tsx`, risultato atteso: C35 verde, test esistenti di Storico e dettaglio invariati (C49).

### [ ] T29. Badge su "Palestra" e testo del puntino

- Copre: C36
- Rischio: alto
- File: `web/src/components/ModeSwitch.tsx`, `web/src/components/OfflineIndicator.tsx` (modifica), `web/src/native/gymStore.ts` (modifica: selettore `pendingCount`), `web/src/components/ModeSwitch.native.test.tsx`, `web/src/components/OfflineIndicator.test.tsx` (modifica)
- Passi:
  1. `pendingCount` = finiti non sincronizzati + voci in `conflict` o `error`.
  2. Badge con N e `aria-label` "N allenamenti da sincronizzare" sul segmento "Palestra", solo nell'IPA e con N > 0.
  3. Testo del puntino con " · N da sincronizzare".
- Verifica: `cd web && npx vitest run src/components`, risultato atteso: C36 verde, test esistenti di `ModeSwitch` e `OfflineIndicator` invariati.

### [ ] T30. Dialogo di conflitto

- Copre: C29, C30
- Rischio: alto
- File: `web/src/components/gym/SyncConflictDialog.tsx` (nuovo), `web/src/components/AppShell.tsx` (modifica: mostrato nelle pagine Palestra), `web/src/pages/gym/WorkoutPage.tsx` (modifica), `web/src/components/gym/SyncConflictDialog.test.tsx` (nuovo)
- Passi:
  1. Per la prima voce in `conflict`, il dialogo mostra il riepilogo delle due copie (nome, inizio, esercizi, serie completate/totale, stato; "Eliminato sul server" se `current` è null) e i pulsanti "Tieni la copia del telefono" e "Tieni la copia del server", che chiamano `resolveConflict`.
  2. Compare in `/gym/*` e nella sessione, solo nell'IPA.
- Verifica: `cd web && npx vitest run src/components/gym/SyncConflictDialog.test.tsx src/components/AppShell.test.tsx`, risultato atteso: C29 e C30 dal punto di vista dell'interfaccia verdi; `AppShell` esistente invariato.

### Chiusura

### [ ] T31. Non regressione completa

- Copre: C41, C42, C45, C47, C50, C51, C52
- Rischio: basso
- File: nessuno (solo correzioni se qualcosa fallisce)
- Passi:
  1. In locale: `cd web && npm test && npm run build && npx eslint src`; `cd api && ruff check app tests && pytest -q tests/test_gym_rules.py tests/test_gym_parity.py`.
  2. Sul remoto: suite completa sul DB `yfp_test` e confronto con un worktree del commit base (`git worktree add ../yfp-base <base>`) usando `comm` sulle righe `FAILED`, con un solo comando che stampa solo la differenza.
- Verifica: comandi locali tutti verdi; sul remoto la differenza delle righe `FAILED` è vuota (C52); i file `test_gym_stats.py`, `test_mcp_tools_workouts.py`, `test_rest_notifier*.py` e `test_gym_routers.py` sono verdi.

### [ ] T32. README

- Copre: C39
- Rischio: basso
- File: `README.md` (modifica)
- Passi:
  1. Nella sezione "iOS app (IPA)" sostituire "Offline, read-only" con la descrizione di R27: allenamento offline completo, sync automatico, Storico "Da sincronizzare", badge, conflitto, dati persi solo con logout confermato o disinstallazione.
  2. Citare `PUT /api/workouts/{uuid}` e `GET /api/workouts/offline-snapshot` nell'elenco API, se presente.
- Verifica: `grep -n "Offline, read-only" README.md` non trova nulla; `grep -n "Da sincronizzare" README.md` trova la nuova riga.

### [ ] T33. Verifica manuale sull'iPhone

- Copre: C17, C23, C29, C31, C36, C37 (sul dispositivo), rischio SideStore
- Rischio: basso
- File: nessuno
- Passi:
  1. Prerequisito: verifica T4 del fix errore-modelli-offline fatta. Server deployato prima dell'IPA (migrazione applicata). IPA da tag su Gitea via SideStore.
  2. Modalità aereo: avvio da modello, tutte le serie, superserie, aggiungi esercizio dal selettore offline, Termina → riepilogo locale; tornata la rete, l'allenamento è nello Storico del server con gli stessi dati, il badge sparisce e "Aggiorna modello" compare.
  3. Riavvio forzato durante un riposo: timer e notifica corretti.
  4. Conflitto: allenamento modificato dal web mentre l'IPA è offline e poi modificato nell'IPA; al ritorno della rete compare il dialogo; provare entrambe le scelte.
  5. Annulla offline di un allenamento già sincronizzato.
  6. Aggiornamento dell'IPA via SideStore con un allenamento non sincronizzato: dopo l'aggiornamento l'allenamento c'è ancora (`Directory.Library` preservata). Se non c'è, registrarlo come rischio aperto.
- Verifica: ogni punto annotato nel Registro di esecuzione come superato o con il difetto riscontrato.

## Registro di esecuzione
T1 — DONE — review: 2 round (MAJOR incremento version in SQL, risolto). Test DB e C11 (downgrade/upgrade + uuid distinti) DA ESEGUIRE SUL REMOTO. avviso nuovo: dipendenze API installate nel Python globale, starlette 0.38.6 in conflitto con streamlit 1.58.0.
T2 — DONE — review: saltata. 45 test verdi in locale. Nota per T10: la conversione degli input (tracking, tuple/frozenset) e in test_gym_parity.py e va ripetuta lato Vitest.
T3 — DONE — review: 1 round, APPROVED. MINOR: api/tests/fixtures/gym_parity.json:52 caso rest_action start_s 0 fuori dominio (RestIn.start_s ge=1), da togliere o documentare prima di T10. Remoto: pytest tests/test_workouts_live.py tests/test_workouts_finish.py tests/test_gym_routers.py tests/test_rest_notifier.py.
T4 — DONE — review: 1 round, APPROVED. MINOR (da gestire in T5/T10): (a) peso float senza arrotondamento a 2 decimali vs Numeric(6,2): limitare a 2 decimali nello schema del PUT o quantize ROUND_HALF_UP in canonical e TS; (b) clamp_times con un solo tra rest_ends_at/rest_total_s azzera il riposo: aggiungere frase a R6 della spec; (c) dopo il clamp rest_ends_at puo superare rest_total_s, e rest_action con delta puo arrivare a 1200 s mentre il PUT taglia a 600: allineare; (d) finished_at non validato per stato: validatore in WorkoutPutIn (null se in corso, obbligatorio se finito). Avvisi per T5: usare AwareDatetime nel corpo del PUT e now aware; formato orari `+00:00` come isoformat (TS non deve emettere `Z`); rest_notified_at (R6) a T5; same_content su canonical_workout del payload PRIMA di clamp_times.
T5 — DONE — review: 3 round (MAJOR uuid duplicati/vincoli, MAJOR controllo versione non atomico -> lock FOR UPDATE in load_workout(for_update) usato da PUT, _load_live, _load_finished, rename; MAJOR test con IntegrityError reale -> test DB-free con _save mockato). Fatti gia in T5: clamp_times e rest_notified_at (T7 aggiunge solo i test di C9). Per T6: (1) distinguere IntegrityError per constraint_name: workouts_uuid_key = corsa alla creazione, ux_workouts_one_in_progress = other_active; (2) controllo 'allenamento finished sul server' PRIMA di ogni scrittura; (3) delete_workout con base_version deve usare for_update=True; (4) allenamento eliminato tra lettura id e lock: 404 -> deve essere version_conflict con current null (R4); (5) test dei vincoli sempre DB-free con _save mockato, mai IntegrityError reale su fixture db. MINOR: ripiego su str(exc.orig) non coperto da test. SPEC da decidere con l'utente (non modificata): R6 un solo campo del riposo -> riposo azzerato; PUT taglia rest_total_s a 600 anche se rest_action con delta puo superare. Remoto: pytest tests/test_workouts_sync.py tests/test_gym_routers.py tests/test_workouts_live.py tests/test_workouts_finish.py tests/test_workouts_version.py tests/test_rest_notifier.py.
T6 — DONE — review: 2 round (MAJOR: db.refresh(user) dopo rollback, altrimenti MissingGreenlet/500 nelle corse). Fatto anche: clamp prima di same_content, test _stored_by_uuid, corsa uuid con stesso contenuto -> 200. Per T17: il client tratta il 404 di un DELETE in attesa con base_version come riuscito e tollera `current: null` in other_active. Avviso: dopo rollback scade request.state.user_session (oggi letto solo da routers/auth.py). Nota T7: orari futuri oltre now+T tagliati con un now diverso a ogni reinvio, quindi reinvio tardivo non idempotente (spec lo accetta). Remoto: pytest tests/test_workouts_sync.py tests/test_gym_routers.py tests/test_workouts_live.py tests/test_workouts_finish.py tests/test_workouts_version.py tests/test_rest_notifier.py.
T7 — DONE — review: 1 round, APPROVED. Solo test (codice gia in T5). MINOR: test_workouts_sync.py:795-813 conteggi notify_due_rests su tutto il DB (filtrare calls per endpoint come _calls_for_endpoints se l'isolamento sul remoto da problemi). Remoto: pytest tests/test_workouts_sync.py tests/test_rest_notifier.py tests/test_rest_notifier_race.py.
T8 — DONE — review: 1 round, APPROVED. Forma snapshot: {server_now, exercises:[{exercise, rest_seconds|null, previous:SetValues[], max:SetValues[]}]} (liste vuote se senza storia): T9 la usa cosi. MINOR: (a) test_workouts_snapshot.py:100 manca test per in_progress con started_at > 90 giorni e per il confine esatto dei 90; (b) :157 isolamento non copre modello/allenamento attivo di Alice; (c) schemas/workout.py:147 `rest_seconds` ha ge=0/le=600 sullo schema di uscita SnapshotExercise: una riga fuori range da 500 all'intero snapshot, usare `int | None` senza limiti come gli altri schemi di uscita. Remoto: pytest tests/test_workouts_snapshot.py. PARTE SERVER T1-T8 COMPLETA: restano da eseguire sul remoto tutti i test DB (vedi righe T1, T3, T5, T6, T7, T8) e il controllo C11.
T9 — DONE — review: saltata. Suite web: 111 file, 804 test verdi. Esportati: fetchOfflineSnapshot, putWorkout, deleteWorkoutChecked, gymKeys.offlineSnapshot, tipi OfflineSnapshot/SnapshotExercise/WorkoutPutBody/ConflictBody.
T10 — DONE — review: 1 round, APPROVED. Suite web 112 file, 904 verdi. Divergenze volute: normalizeSupersets e formatSetText copiati in gymRules.ts (gym.ts importa api/client.ts); roundKg half-up float-safe, canonicalWorkout TS arrotonda il peso mentre canonical_workout Python no (lo fa lo schema del PUT). MINOR per T11/T12: (a) i reducer scrivono i pesi SEMPRE arrotondati con roundKg (cosi formatSet e formatSetText coincidono e canonical TS = server); (b) usare solo stringhe prodotte da isoOffset (UTC, ms, +00:00): date non valide o senza offset divergono da Python; (c) mai `undefined`, sempre `null` (setProblem e sameContent via JSON.stringify trattano undefined diverso da null); (d) clampTimes riscrive in UTC ms: va bene se il client produce solo UTC ms; (e) debito: spostare normalizeSupersets in gymRules.ts e far importare gym.ts da li (task successivo, non ora); formatKg non esportata in gymRules.ts ma gym.ts ne esporta una omonima diversa: attenzione agli import automatici.
T11 — DONE — review: 1 round, APPROVED. Suite web 113 file, 932 verdi. Reducer: reduceSession(state, action, {now, uuid}) -> {ok:true,state}|{ok:false,error,state(stesso riferimento)}; errori = messaggi del server; `liveErrorMessage` sta in web/src/lib/gym.ts (non liveErrors.ts) e vuole un ApiError: in T15 serve un helper stringa -> `LIVE_ERRORS[msg] ?? msg`. `addSet` riceve `previousFirst` nell'azione (lo da il selettore di T12); posizione = indice nell'array. Decisione: range fuori limiti server -> 'Valori non validi' (= 422 di liveErrorMessage). Per T14: mappare version -> base_version; non inviare id/name/tracking degli esercizi. MINOR da fare in T12 (stessi file): (a) gymSession.ts:198 addSet senza tetto: il PUT rifiuta >100 serie per esercizio (422), quindi dopo la 101a la sync fallirebbe sempre -> rifiutare in addSet con 'Valori non validi' a sets.length >= 100; (b) :109 controllare il range sul valore grezzo PRIMA di roundKg (come SetPatch); (c) test C18: aggiungere caso b1 poi a1 con attesa 120 (riposo di B, ultimo del gruppo); (d) test: confini restDelta +-600/+-601, duration 36000/36001, arrotondamento su patchSet.

T12 — DONE — review: 2 round (MAJOR previousAndMax: il hit di lastServer vale solo con stesso exercise.id e stesso indice, altrimenti snapshot). Suite web 114 file, 979 verdi. Chiusi i 4 MINOR di T11 (tetto 100 serie, range sul grezzo, C18 b1->a1, confini). Selettori esportati: previousAndMax(entry, snapshot) -> Map<uuid serie,{previous,max}>, previousFirst(exerciseId, snapshot). Tetti R3 applicati nel reducer (100 esercizi, 100 serie, nome 1-100 dopo strip, nota <=500 code point, riposo 0-600). Fuso del nome libero: Europe/Rome fisso (= default server settings.app_timezone). C33 (logica) NON e in T12: la logica e in T17 (cancelLocal) e il test in T27 -> aggiungere C33 alla riga 'Copre' di T17. restDelta puo superare 600 s nel reducer, il PUT taglia (accettato, spec.md:193). MINOR rimasti: (a) gymSession.ts:154-158 commento su stripText errato (pydantic NON toglie U+001C-U+001F: la regex e un superset voluto, sicuro); (b) workout.test.ts:417-423 titolo test 'come lo strip di pydantic' impreciso; (c) workout.test.ts:643-690 manca test che il valore del server sopravviva a un riordino con setLayout.

T13 — DONE — review: 2 round (MAJOR loadFromDisk: un tmp valido ha ora precedenza sul principale; MINOR chiusi: ordine cancellazioni tmp->principale, retry con backoff 1-30 s, validazione esercizi/serie, test no-write-prima-del-load, boot.gymStore.test.ts). Suite web 116 file, 1023 verdi. API gymStore: subscribe, getSnapshot, dispatch(uuid, action), startEmptyWorkout, startWorkoutFromTemplate, patchEntry, removeEntry, addPendingDelete, removePendingDelete, setTemplateProposals, setClockOffset, setGymUserId, loadGymStore, flushGymStore, clearGymStore. GymEntry = {workout, baseVersion, revision, sentRevision, sync, conflict, lastServer}; id server in workout.id; patchEntry tiene workout.version = baseVersion. Browser: funzioni su file no-op, operazioni in memoria attive (nessun componente usa lo store nel web). RISCHIO APERTO PER T33/iPhone: comportamento del `rename` nativo di Capacitor Filesystem quando la destinazione esiste (sorgenti nativi non verificabili qui; ripiego: cancella il vecchio dopo aver verificato il tmp; il tmp valido viene recuperato al load). MINOR rimasti: (a) gymStore.ts:155-160 corsa errore di scrittura vs wipe: dopo un clear puo restare un timer e ricreare il file vuoto (usare un contatore di generazione incrementato da wipe); (b) :337-340 crash tra le due cancellazioni del logout: i dati riappaiono (accettato; alternativa: scrivere prima in tmp uno store vuoto); (c) :286-290 fileExists tratta ogni errore di stat come file assente (distinguere not-found e non scrivere in sessione se altro errore). T14-T18 non devono chiamare lo store fuori dal render prima del boot; setGymUserId dopo il boot.

REMOTO 2026-10-14 (riferito dall'utente, DB yfp_test, fastapi 0.143 / starlette 1.7): pytest tests/test_workouts_version.py test_workouts_sync.py test_workouts_snapshot.py test_gym_routers.py test_workouts_live.py test_workouts_finish.py test_rest_notifier.py test_rest_notifier_race.py -> 95 passati, 1 fallito: test_workouts_snapshot.py::test_snapshot_route_is_declared_before_the_workout_id_route (il test legge app.routes, che con fastapi 0.143 non elenca le rotte dei router inclusi: difetto del test, non dell'endpoint; il test DB test_snapshot_matches_what_a_new_workout_shows prova l'ordine). CORRETTO in locale (commit 'correzione T8'): il test ora legge workouts_router.routes (APIRoute), non app.routes. DA RIPROVARE sul server con fastapi 0.143. C11: alembic downgrade -1 && upgrade head su yfp_test -> OK (riferito dall'utente: 'tutto ok'). Ancora da verificare su DB reale dopo il deploy: righe esistenti con uuid distinti e version 1 (C11, backfill). Nota: l'ambiente locale ha fastapi 0.115 / starlette 0.38.6: il server e piu recente.

T14 — DONE — review: 1 round, APPROVED. Suite web 117 file, 1036 verdi. API: `syncEntry(uuid, queryClient) -> Promise<"synced"|"pending"|"conflict"|"error"|"unauthorized"|"missing">`. DEVIAZIONE VOLUTA dal passo 1: `sentRevision` si scrive nello store solo a risposta 200/201 accettata (valore inviato, catturato prima dell'await), non all'inizio dell'invio: altrimenti dopo 5xx/NetworkError `revision === sentRevision` e T15 (invia se `revision !== sentRevision`) non ritenterebbe. Per T15: (a) `sentRevision` non indica un invio in corso: il vincolo "al più un PUT in volo per uuid" richiede un insieme in memoria; (b) voci `conflict`/`error` hanno `revision !== sentRevision`: lo scheduler filtra per `sync`; (c) una 2xx senza `uuid`/`version` fa rigettare `syncEntry` (gymSync.ts:21-23,135-136, JSDoc riga 167 dice il contrario): catturare nello scheduler oppure restituire "error". Per T17: voce tolta durante il volo (Annulla locale di un mai sincronizzato) + PUT riuscito -> esito "missing" ma sul server resta un `in_progress` orfano (poi `other_active`): `cancelLocal` deve attendere il PUT in volo e poi fare DELETE con l'id ricevuto, o registrare un pendingDelete con `server.id`. MINOR: manca test "Termina durante il volo" (gymSync.test.ts:212; atteso: voce resta `finished` pending con id e baseVersion). AVVISO: `npx eslint src` non esegue, il repo non ha `eslint.config.*` (ESLint 10): il passo di lint di T31 non gira, da decidere (aggiungere config o togliere il passo).

T15 — DONE — review: 2 round (MAJOR syncNow: con un PUT in volo + Termina restituiva 'pending' con rete presente, violando C32 -> sendUntilSettled ripete solo se 'pending' con sentRevision avanzato e rete presente; MINOR: il giro si ferma solo su unauthorized/offline, non su 5xx; test C24 a livello scheduler; commento sul ramo 2xx senza uuid/version). Suite web 118 file, 1054 verdi. API: startGymSync(queryClient) -> stop; syncNow(uuid, timeoutMs) -> SyncOutcome|'timeout' ('pending' se non avviato); syncEntry ora non lancia mai (2xx senza uuid/version -> 'error'; il server puo aver gia accettato, il ritento puo dare 409). Debounce 1 s (SETTLE_MS), voci 'error' ritentate solo con run(true) (apertura, primo piano). Aggiunto test di avvio/stop in NativeOfflineServices.test.tsx e 'Termina durante il volo' in gymSync.test.ts. Per T16: setGymUserId NON e chiamato da T15 (resta a T16/T18); adoptServerActive deve girare PRIMA dei PUT all'apertura/primo piano (oggi run(true) parte subito: coordinare l'ordine in startGymSync). Per T17: syncNow dopo il timeout prosegue in background.

T16 — DONE — review: 3 round (round 1: BLOCKER finito offline riadottato come attivo con stesso uuid in_progress sul server, 2 MAJOR: GET in ritardo che rimuove un locale appena creato; uuid diverso con locale pulito mai convergente; round 2: MAJOR chiave di stato solo sull'attivo, non su finished/pendingDeletes -> confronto per identita dei riferimenti active/finished/pendingDeletes). Suite web 119 file, 1081 verdi. DECISIONE UTENTE 2026-10-14 (chiarimento di R17, spec non modificata): locale attivo pulito (revision===sentRevision, sync 'synced', baseVersion non null, nessun PUT in volo) + attivo del server con uuid DIVERSO -> si rimuove il locale e si adotta quello del server; con modifiche in attesa/conflict/error/PUT in volo resta il 409 other_active. API: adoptServerActive() in gymSync.ts, gymStore.adoptActiveEntry (no-op se c'e gia un attivo), fetchActiveWorkout esportato da api/gym.ts (usato anche da useActiveWorkout). Adozione prima dei PUT all'apertura e al primo piano (run(true,true)); errore rete/5xx -> i PUT proseguono, 401 -> nessun PUT; adozione fallita -> si rifa al primo ritorno della rete. Non adotta se l'uuid e gia in finished o se server.id e in pendingDeletes. Per T17: addPendingDelete/removePendingDelete gia protetti dall'adozione; cancelLocal deve gestire un PUT in volo (vedi T14). Per T18: setGymUserId non e ancora chiamato da nessuno. Test esistenti modificati: gymSyncScheduler.test.ts (mock di fetchActiveWorkout, default 204), NativeOfflineServices.test.tsx (route /workouts/active esclusa dalla sequenza del precarico).

T17 — DONE — review: 2 round (MAJOR DELETE in attesa senza guardia di invio doppio → Set deletesInFlight + ricontrollo nello store + restoreEntry idempotente; MINOR chiusi: 4xx del DELETE → 'error' ritentato solo con retryErrors, commento 409 senza entry). Suite web 120 file, 1099 verdi. API gymSync: resolveConflict(uuid, "local"|"server"), cancelLocal(uuid); gymStore: restoreEntry, replaceEntry. DEVIAZIONI accettate: `PendingDelete.entry?: GymEntry` (copia del telefono, per mostrare le due copie nel 409 d'annullamento; opzionale, SCHEMA_VERSION invariato); `deleteWorkoutChecked(id, baseVersion?)` senza query se baseVersion assente (api/gym.ts); C33 aggiunto a 'Copre'. Per T30 (dialogo): "Tieni la copia del telefono" su un conflitto nato da un annullamento fa un PUT (l'allenamento ricompare sul telefono, l'utente deve riannullare): chiarirlo nel testo del dialogo e confermare con l'utente. MINOR rimasti: (a) gymSync.ts:294-302 il ricontrollo del PendingDelete invia la copia presa a inizio giro: con 2+ annullamenti e un PUT che finisce durante il giro parte un DELETE con base_version vecchia → 409 spurio (rileggere la voce dallo store prima di inviare); (b) gymSync.ts:306-307 l'id resta in deleteErrors se addPendingDelete sostituisce l'annullamento (toglierlo alla sostituzione); (c) restoreEntry finisce in finished se c'è già un attivo locale: 'copia del server' non riesce mai (documentare nel dialogo T30); (d) annullamento di un mai sincronizzato con PUT in volo che fallisce per rete dopo il salvataggio server: nessun annullamento in attesa, adoptServerActive lo riadotta (rischio aperto).

T18 — DONE — review: 1 round, APPROVED. Suite web 121 file, 1105 verdi. DEVIAZIONI accettate: gate di identità in gymSync.ts (fuori lista): `confirmGymUser(userId, token)` chiamata da fetchMe in AuthContext, `identityConfirmed()` in sendOnce/sendQueue/adoptServerActive/resolveConflict(local), aperto se userId null; NativeOfflineServices invalida ["me"] all'avvio con token; logout nativo svuota lo store sempre (anche N=0). `pendingCount` in gymStore.ts = finiti + attivo con modifiche non inviate o conflict/error + pendingDeletes: serve al dialogo di logout; T29 NON deve riusarlo per il badge (R23/C36: finiti non sincronizzati + conflict/error) → selettore separato in T29. MINOR rimasti: (a) AuthContext.tsx:54 finestra di logout: clearGymStore() gira con token ancora presente, un ritorno in primo piano può far riadottare l'attivo di A prima di clearToken() → chiamare clearGymStore() una seconda volta dopo clearToken(); (b) gymSync.ts:249-253 userId null con dati mai confermati passa il gate con il token di un altro utente: aprire il gate con userId null solo se lo store è vuoto; (c) test mancanti: ["me"] con token sostituito ignorata, adozione non parte prima della conferma, invalidazione ["me"] all'avvio in NativeOfflineServices. avviso: `npx eslint` non esegue (nessuna config nel repo).

T19 — DONE — review: 1 round, APPROVED. Suite web 121 file, 1113 verdi (verificata dall'orchestratore). Fuori lista, deciso dall'orchestratore: `web/src/components/NativeRestAlertSetting.tsx` (+test) leggeva ancora la query cache `gymKeys.active`: ora legge lo store (getSnapshot) e chiama syncRestNotification(workout, clockOffsetMs). API: `syncRestNotification(workout: RestSource | null, offsetMs?)`. NativeBridge si iscrive a gymStore, deduplica su (nome, rest_ends_at, clockOffsetMs). C23/C37/C46 verificati nei test; riavvio dopo 30 s testato con Date.now mockato, DA VERIFICARE SU iPHONE (T33). MINOR rimasti: (a) NativeBridge.tsx:18-21 la chiave include clockOffsetMs ma setClockOffset cambia a ogni PUT accettato/adozione (gymSync.ts:160,438) → cancel+schedule della 4101 a ogni sync: mettere clockOffsetMs nella chiave solo con rest_ends_at non null e arrotondarlo al secondo, o correggere il commento; (b) NativeBridge.tsx:29 con store vuoto al mount nessun cancel: una 4101 residua da sessione precedente (file corrotto, primo avvio dopo l'aggiornamento) può suonare a vuoto, non è regressione (opzionale: syncFromStore() sempre al mount, aggiornando il test); (c) manca test 'store vuoto al mount, poi loadGymStore con riposo in corso → schedule'.

T20 — DONE — review: 1 round, APPROVED. Suite web 121 file, 1116 verdi. Aggiunto `load(gymKeys.offlineSnapshot, () => fetchOfflineSnapshot())` in gymTasks (prefetch.ts:119); cachePrune.ts e queryPersistence.ts invariati (chiave non prunabile, persistita: verificato dal reviewer). Test C9 'storico aperto': filtro '/workouts/' → /^\/workouts\/\d+$/ (lo snapshot lo catturava). CLIENT-CORE T9-T20 COMPLETO. MINOR rimasti: (a) prefetch.test.ts:22,299-300 il mock di ./gymStore è guardia debole (prefetch.ts non importa il modulo): usare vi.mock che lancia o controllo statico del sorgente, e spy su getQueryData per gymKeys.active; (b) cachePrune.test.ts: aggiungere [["gym","offline-snapshot"], false] alla tabella di isPrunableKey.

T21 — DONE — review: saltata. Suite web 124 file, 1143 verdi (+27). Nessun file di produzione toccato; helper di test nuovo `web/src/test/liveSession.tsx` (fixture, stub fetch che registra le richieste non GET, render di WorkoutPage). Per T22: WorkoutExerciseCard.test e WorkoutPage.actions.test usano gli hook veri con fetch stubbato (devono restare verdi invariati); ActiveWorkoutBar.test e GymStartPage.test mockano gli hook come i test esistenti (in GymStartPage si asserisce l'argomento di start.mutate, non il POST). Su web fetch rifiuta con TypeError (non NetworkError): il test del toast usa NetworkError, liveErrorMessage mappa entrambi. La riga 'Riposo' della card compare dopo ogni serie. Il toast su NetworkError ritarda ~3 s per i retry di useLiveMutation (timeout test 10 s).

T22 — DONE — review: 1 round, APPROVED. Suite web 124 file, 1143 verdi, nessun test modificato. API: `web/src/lib/liveSession.ts` (`keyOf(item)` = uuid ?? String(id), `LiveCallbacks<T>`, interfaccia `LiveSession`: workout: Workout, clockOffsetMs?, isFinishing, isCancelling, rename, addExercises(ExerciseRef[]), replaceExercise(exUuid, ref), removeExercise, setNote, setRest, setLayout(LayoutEntry[]), addSet(exUuid), patchSet/completeSet(setUuid, values), uncompleteSet/deleteSet, restStart/restDelta/restSkip, finish(discardIncomplete, {onSuccess({id:number}), onError(msg)}), cancel({onSuccess,onError})); `web/src/api/serverSession.ts` `useServerSession(workout)` (contiene liveErrorMessage); WorkoutPage: WorkoutSession (loading) + LiveWorkout (corpo); WorkoutExerciseCard riceve `session` al posto di `workoutId`; RestTimerBar `offsetMs?`. DEVIAZIONE accettata: SetRow.tsx NON modificato (handler già legati all'uuid dalla card, key={keyOf(set)}). PER T23/T25 (MINOR del reviewer da trattare): (a) WorkoutPage.tsx:93 LiveWorkout legge sia il prop `workout` sia `session.workout`: usare ovunque `const workout = session.workout` (con la sessione locale mostrerebbe dati diversi); (b) liveSession.ts:42 `finish` onSuccess({id:number}) non permette l'esito senza id del server: in T25 cambiare in `{ id: number | null; uuid: string }` o esito discriminato; (c) liveSession.ts:20 `workout: Workout` vuole id numerici, Exercise completo, previous/max_set nelle serie, server_now, template_diff mentre lo stato IPA è SessionWorkout (id null, solo exercise_id/name/tracking, previous/max separati in PreviousAndMax): T23 scrive un adattatore SessionWorkout → Workout (id segnaposto) o restringe il tipo esposto ai campi letti dalla UI.

T23 — DONE — review: 1 round, APPROVED. Suite web 125 file, 1147 verdi. API `web/src/native/localSession.ts`: `useActiveSession(): ActiveSession` (IPA: store + snapshot da ["gym","offline-snapshot"] con useQuery enabled:false; browser: useActiveWorkout invariato; ramo scelto con isNative() una volta per esecuzione), `useLocalSession(): LiveSession | null` (ogni operazione dispatch(uuid, action); errori del reducer al toast via `liveErrorText`, nuovo export in lib/gym.ts fuori lista), `startLocalWorkout(template | null): string | null`, adattatore `workoutView(entry, snapshot, clockOffsetMs): Workout` (id server mancanti = 0, la UI identifica per uuid; previous/max_set da previousAndMax; server_now = ora + offset; template_diff = []). `TemplatePreviewSheet.onStart` riceve il `Template` (web usa template?.id). WorkoutPage: WorkoutSession → ServerWorkout | LocalWorkout; LiveWorkout({session}) legge solo session.workout. PER T25/T27: `finish`/`cancel` della sessione locale sono STUB (onError "Non ancora disponibile nell'app", nessuna modifica allo store); `finish.onSuccess({id:number})` va esteso in T25 (id: number|null, uuid) e il riepilogo `/gym/history/${finished.id}` oggi è irraggiungibile nell'IPA. MINOR rimasti: (a) WorkoutPage.tsx:68-73 `useOfflineUnavailable` è `isNative() && ...` e nell'IPA la sessione locale non ha mai fetchStatus 'paused': ramo morto, commento errato → correggere il commento o togliere il ramo; (b) localSession.ts:144 chiamata condizionale di hook (corretta a runtime, rules-of-hooks la segnalerebbe se ci fosse config ESLint); (c) WorkoutPage.local.native.test.tsx:274 C21 asserisce solo kg della serie 1: aggiungere rip. serie 1 = 8, kg/rip. serie 2 = 80/6; (d) workoutView calcolato due volte a ogni render (trascurabile). AVVISO per T33: tempo trascorso di WorkoutPage/ActiveWorkoutBar sull'orologio del telefono con started_at stimato sull'orologio del server (scarto sommato all'elapsed); C20 testato col pulsante disabilitato; test C21 con ExercisePicker mockato (offline in T24).

T24 — DONE — review: 1 round, APPROVED. Suite web 126 file, 1153 verdi. API `web/src/lib/localExercises.ts`: `localExercises(queryClient, filters = EMPTY_FILTERS)` (unione per id: catalogo ["gym","exercises",EMPTY_FILTERS] → snapshot → dettagli modello ["gym","template",id]; filtri nome icontains/attrezzo/muscolo come il server; ordine per nome). ExercisePicker: offline = isNative() && isOffline() → LocalExerciseList (montato solo offline); '+ Nuovo' offline → Sheet con OfflineUnavailable; con rete invariato. Fuori lista, accettato dal reviewer: `web/src/components/offline.gymStats.native.test.tsx` (il describe 'ExercisePicker offline' asseriva il vecchio comportamento sostituito da R14; copertura del messaggio offline resta nel describe 'ExerciseList offline'). ExercisePicker.test.tsx invariato. Nota: TemplateEditorPage nell'IPA offline mostra ora la lista locale ma il salvataggio modello resta online (accettato). MINOR rimasti: (a) ExercisePicker.tsx:36 LocalExerciseList legge la cache con getQueryData senza iscriversi (si aggiorna solo al cambio filtro; raro offline); (b) :39 cast `as unknown as ReturnType<typeof useExercises>` fragile: estrarre da ExerciseList un componente che riceve `items`; (c) ordine locale per nome, il server con q ordina per similarity (accettabile).

Partenza: e92ca5d2d142cfa071bd685f5916b273e98df1fc su main
