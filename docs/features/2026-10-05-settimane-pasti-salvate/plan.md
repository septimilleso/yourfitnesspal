# Piano: Settimane di pasti salvate

- Data: 2026-10-05
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: feature
- Branch: feature/settimane-pasti-salvate

## Approccio

Due nuove tabelle (`saved_weeks`, `saved_week_items`) e un servizio condiviso `api/app/services/saved_weeks.py` con router sottile `api/app/routers/saved_weeks.py`, sul modello di `services/templates.py` + `routers/templates.py` (router sottile, servizio con `ensure_permission(user, Permission.diary_copy)`, `own_saved_week` che alza `NotFound` per righe altrui). La logica pura (validazione nome e lunedì, normalizzazione dei giorni, totali, mappatura verso `plan_copy`) vive in `api/app/services/saved_week_rules.py`, testabile senza DB come `gym_rules.py` e `stats_rules.py`.

L'applicazione riusa `plan_copy` (`api/app/services/diary.py`) alimentandola con righe sorgente "finte" mappate su date di appoggio (lunedì `2001-01-01` + `day_index`) e con i nutrienti correnti di `Food.nutriments`. L'esecuzione di cancellazioni e inserimenti (oggi dentro `copy_days` in `api/app/services/diary_ops.py`) viene estratta in un helper `apply_copy_plan`, usato da `copy_days` e da `apply_saved_week`, senza cambiare il comportamento di `copy_days`. Prima dell'estrazione un task di caratterizzazione fissa i comportamenti non ancora coperti (403 e posizioni in `append`).

Lato web: hook in un nuovo `web/src/api/savedWeeks.ts` (stile `web/src/api/weights.ts`), un componente condiviso `CopyOptionsFields` estratto da `CopyDaysDialog` (data di inizio, pasti, modalità, con le stesse etichette e gli stessi id), un nuovo `ApplySavedWeekDialog`, due pagine sotto `/week/saved` e `/week/saved/:id` dentro `AppShell` e `PermissionGuard permission="diary.copy"` (così `modeFromPath` e la tab Settimana attiva non cambiano), e due comandi nuovi in `WeekPage`.

Verifiche server. Non c'è Postgres in locale: i task server si verificano in locale con `ruff`, import di `app.main`, `pytest` dei soli test senza DB (`saved_week_rules`), `pytest --collect-only` e `alembic upgrade --sql` offline. I comandi locali partono da `api/` e usano `.venv/Scripts/python -m pytest ...` come nelle altre feature. I test con DB (marcati "remoto") sono scritti nei task ma girano solo dopo `git push` del branch e `git pull` sul server, via `docker compose exec api pytest <file> -v`; la corsa completa è in T17. Nessun task dichiara verdi in locale test che richiedono DB.

Scelte prese dal piano dove la spec lascia margine:
- Nome vuoto o oltre 100 caratteri: il servizio alza `Invalid` (400, stesso formato degli altri 400), non la validazione pydantic (422).
- `days` dell'apply: deduplicati e ordinati; valori fuori da 0..6 o lista vuota danno `Invalid` (400); `null` = tutti e 7.
- `saved_week_items.day_index` ha in più un `CheckConstraint` 0..6 (la spec elenca solo "0–6"); è una difesa a costo zero.
- Risposte: elenco = `list[SavedWeekSummary]` con `entries_count` e `avg_kcal` (media sui soli giorni con entry); dettaglio = summary + `days` (sempre 7, `day_index` 0..6, `meals` con le 4 chiavi, `total` nutrienti).

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Test di caratterizzazione di `POST /api/diary/copy` (403 e posizioni in append)

- Copre: C16, C17 (prepara C15)
- File: `api/tests/test_diary_copy_permission.py` (nuovo)
- Contesto: `api/app/routers/diary.py` protegge `POST /api/diary/copy` con `require_permission(Permission.diary_copy)`; `copy_days` in `api/app/services/diary_ops.py` assegna le `position` con `_next_position`. I test esistenti (`api/tests/test_diary_copy.py`) coprono solo 401, append in giorno vuoto, replace, overlap, snapshot verbatim, 400 su `source_dates` vuoto. Mancano il 403 per utente senza permesso e l'append in un giorno che ha già entry. Questo task non tocca il codice di produzione.
- Passi:
  1. Usare `make_user`, `make_food`, `http_client` da `api/tests/factories.py` e la fixture `db` di `api/tests/conftest.py` (stile `api/tests/test_mcp_tools_diary.py`). Un utente con `permissions=[]` e ruolo `Role.user` chiama `POST /api/diary/copy` con body valido: atteso 403 e `{"detail": "forbidden"}`.
  2. Un utente con `permissions=["diary.copy"]`: crea via `POST /api/diary/entries` una colazione al giorno A e una colazione già presente al giorno B; copia A su B in `append`; `GET /api/diary/day/B` deve mostrare le due colazioni con `position` 0 (esistente) e 1 (nuova), nell'ordine.
- Verifica: locale `cd api && .venv/Scripts/python -m pytest tests/test_diary_copy_permission.py --collect-only -q` (raccoglie 2 test) e `.venv/Scripts/python -m ruff check tests/test_diary_copy_permission.py`. Remoto (dopo push e pull, DB): `docker compose exec api pytest tests/test_diary_copy_permission.py -v`, 2 test verdi, e devono essere verdi PRIMA di T2 (sono caratterizzazione del comportamento esistente).

### [x] T2. Estrarre `apply_copy_plan` da `copy_days` (nessun cambio di comportamento)

- Copre: C15, C16, C17
- File: `api/app/services/diary_ops.py` (modifica)
- Contesto: `copy_days` oggi legge le entry sorgente, chiama `plan_copy`, poi esegue prima tutte le `deletes` (`sa.delete(DiaryEntry)` per `(target_date, meal_set)`), poi gli `inserts` con un dict `next_position` basato su `_next_position`, poi `db.commit()` e restituisce `DiaryCopyResponse`. `plan_copy` non si tocca.
- Passi:
  1. Aggiungere in `diary_ops.py` `async def apply_copy_plan(db: AsyncSession, user: User, plan: dict) -> DiaryCopyResponse` con esattamente il corpo oggi dopo la chiamata a `plan_copy` (deletes, inserts con posizioni, `commit`, costruzione della risposta). Una sola transazione, un solo `commit` finale.
  2. `copy_days` mantiene `ensure_permission`, la validazione `source_dates` vuoto, la lettura prima delle cancellazioni e la chiamata a `plan_copy`, poi `return await apply_copy_plan(db, user, plan)`.
  3. Non cambiare firme pubbliche né import dei chiamanti (`api/app/routers/diary.py`, `api/app/mcp/tools/diary.py`).
- Verifica: locale `cd api && .venv/Scripts/python -m ruff check app/services/diary_ops.py && .venv/Scripts/python -c "import app.main"` (nessun errore) e `.venv/Scripts/python -m pytest tests/test_diary_copy_service.py -q` (verde, senza DB). Remoto: `docker compose exec api pytest tests/test_diary_copy.py tests/test_diary_copy_service.py tests/test_diary_copy_permission.py tests/test_mcp_tools_diary.py -v`, tutti verdi senza modificare nessun test.

### [x] T3. Modelli `SavedWeek` e `SavedWeekItem` e migrazione

- Copre: fondamenta di C1, C12 (cascata alla cancellazione)
- File: `api/app/models/saved_week.py` (nuovo), `api/app/models/__init__.py` (modifica: import ed export), `api/alembic/versions/c4d7a2f81b56_saved_weeks.py` (nuovo), `api/tests/test_saved_week_models.py` (nuovo)
- Contesto: modello da imitare `api/app/models/diary.py` (`DiaryEntry`: enum `Meal` con `values_callable`, `sa.Numeric(10, 2)`, FK `food_id` `RESTRICT`) e `api/app/models/weight.py` per `created_at`. Head attuale: `a6c1e4b8d203` (`api/alembic/versions/a6c1e4b8d203_body_weights.py`). L'enum Postgres `meal` esiste già (creata in `162b1885de07_foods_food_portions_diary_entries_.py`): nella migrazione usare `postgresql.ENUM("breakfast", "lunch", "dinner", "snack", name="meal", create_type=False)` per non ricrearla.
- Passi:
  1. `SavedWeek`: `id`, `user_id` FK `users.id` `ON DELETE CASCADE` con indice, `name` `String(100)` non nullo, `created_at` `DateTime(timezone=True)` `server_default=sa.func.now()`, relationship `items` (`cascade="all, delete-orphan"`, `passive_deletes=True`, `order_by` giorno, pasto, posizione).
  2. `SavedWeekItem`: `id`, `saved_week_id` FK `saved_weeks.id` `ON DELETE CASCADE` con indice, `day_index` `Integer` con `CheckConstraint("day_index BETWEEN 0 AND 6")`, `meal` (stesso `sa.Enum(Meal, name="meal", values_callable=...)` di `DiaryEntry`, nome enum `meal`), `food_id` FK `foods.id` `ON DELETE RESTRICT` con indice, `grams` `Numeric(10, 2)`, `portion_label` `String(100)` nullabile, `position` `Integer` default 0, relationship `food` (`Food`).
  2. Esportare i due modelli in `api/app/models/__init__.py` (import e `__all__`).
  3. Migrazione con `down_revision = "a6c1e4b8d203"`, `upgrade` crea le due tabelle (e gli indici), `downgrade` le elimina nell'ordine inverso. Non toccare `meal_templates`.
  4. Test DB (stile `api/tests/test_weight_models.py`): cancellare l'utente elimina le sue settimane e le righe; cancellare la settimana elimina le righe; cancellare un `Food` referenziato da una riga solleva `IntegrityError`; `day_index=7` solleva `IntegrityError`.
- Verifica: locale `cd api && .venv/Scripts/python -m ruff check app/models alembic/versions/c4d7a2f81b56_saved_weeks.py tests/test_saved_week_models.py && .venv/Scripts/python -c "import app.models"`, poi `.venv/Scripts/python -m alembic upgrade a6c1e4b8d203:c4d7a2f81b56 --sql` (SQL offline con `CREATE TABLE saved_weeks` e `saved_week_items`, senza `CREATE TYPE meal`) e `.venv/Scripts/python -m alembic heads` (un solo head). Remoto: `docker compose exec api alembic upgrade head` poi `docker compose exec api pytest tests/test_saved_week_models.py -v`, 4 test verdi.

### [x] T4. Schemi Pydantic e regole pure (`saved_week_rules`)

- Copre: C2 (nome e lunedì), C4 (totali), C7 (mappatura giorni su `plan_copy`), C11 (nutrienti correnti)
- File: `api/app/schemas/saved_week.py` (nuovo), `api/app/services/saved_week_rules.py` (nuovo), `api/tests/test_saved_week_rules.py` (nuovo)
- Contesto: schemi da imitare in `api/app/schemas/diary.py` (`DiaryCopyRequest`, `DiaryCopyResponse`, `Nutriments` da `app/schemas/food.py`); errori in `api/app/services/errors.py` (`Invalid`, `NotFound`); `plan_copy`, `compute_day_totals`, `zero_totals` in `api/app/services/diary.py`. Le funzioni di `saved_week_rules.py` sono pure e duck-typed: gli item espongono `.day_index`, `.meal`, `.food_id`, `.grams`, `.portion_label`, `.food.nutriments`.
- Passi:
  1. Schemi: `SavedWeekCreate {name: str, start: date}`, `SavedWeekRename {name: str}`, `SavedWeekApply {days: list[int] | None = None, target_start: date, meals: list[Meal] | None = None, mode: Literal["append","replace"] = "append"}`, `SavedWeekItemOut {id, food_id, food_name, food_brand, grams: float, portion_label, position}`, `SavedWeekSummary {id, name, created_at: datetime, entries_count: int, avg_kcal: float}`, `SavedWeekDayOut {day_index: int, meals: dict[str, list[SavedWeekItemOut]], total: Nutriments}`, `SavedWeekDetail(SavedWeekSummary)` con `days: list[SavedWeekDayOut]`. La risposta di apply riusa `DiaryCopyResponse`.
  2. `saved_week_rules.py`: `ANCHOR_MONDAY = date(2001, 1, 1)`; `clean_name(name) -> str` (strip, 1..100, altrimenti `Invalid`); `ensure_monday(start)` (`Invalid` se `start.weekday() != 0`); `normalize_days(days) -> list[int]` (None = 0..6; vuota o fuori 0..6 = `Invalid`; deduplica e ordina); `item_day_totals(items) -> dict[int, dict]` e `week_stats(items) -> (entries_count, avg_kcal)` usando `compute_day_totals` con adattatore che espone `nutriments_snapshot = item.food.nutriments` (media kcal sui soli `day_index` con entry, 0.0 se nessuna); `plan_apply(items, days, target_start, meals, mode) -> dict` che costruisce `entries_by_source_date` con chiavi `ANCHOR_MONDAY + timedelta(days=day_index)` e righe con i nutrienti correnti del cibo, e chiama `plan_copy(source_dates=[anchor + d for d in days], ...)`. Non reimplementare la mappatura posizionale.
  3. Test senza DB (`SimpleNamespace`/dataclass finti, stile `api/tests/test_diary_copy_service.py`): nome (strip, vuoto, 100 ok, 101 errore); `ensure_monday` (lunedì ok, martedì errore); `normalize_days` (None, vuota, 7, duplicati, ordinamento); `week_stats`; `plan_apply` con giorni `[1, 3]` e `target_start=2026-10-12` → inserts il 12 e il 13 (C7), filtro pasti, `replace` con giorno salvato vuoto produce comunque la delete (come `plan_copy`), `nutriments_snapshot` uguale ai nutrienti correnti del cibo e non a uno snapshot vecchio (C11); confronto di equivalenza: `plan_apply` e `plan_copy` diretta con le stesse righe danno lo stesso `days`/`deletes`.
- Verifica: locale `cd api && .venv/Scripts/python -m pytest tests/test_saved_week_rules.py -q` (verde, senza DB) e `.venv/Scripts/python -m ruff check app/schemas/saved_week.py app/services/saved_week_rules.py tests/test_saved_week_rules.py`.

### [x] T5. Servizio e router: salva, elenca, dettaglio

- Copre: C1, C2, C3, C4, C5, C13 (parte API)
- File: `api/app/services/saved_weeks.py` (nuovo), `api/app/routers/saved_weeks.py` (nuovo), `api/app/main.py` (modifica: import e `include_router`), `api/tests/test_saved_weeks.py` (nuovo)
- Contesto: struttura da imitare `api/app/services/templates.py` (`own_template` → `own_saved_week`, `NotFound`) e `api/app/routers/templates.py`; permesso come `POST /api/diary/copy` (`Depends(require_permission(Permission.diary_copy))` nel router e `ensure_permission(user, Permission.diary_copy)` nel servizio); `main.py` registra i router con `dependencies=[Depends(get_current_user)]` ed è già mappato `NotFound`→404, `Invalid`→400, `PermissionMissing`→403. Prefisso router `/api/saved-weeks`.
- Passi:
  1. `create_saved_week(db, user, payload)`: `ensure_permission`, `clean_name`, `ensure_monday(start)`, legge le `DiaryEntry` dell'utente in `start..start+6` ordinate per data, pasto, posizione; se zero → `Invalid("la settimana non ha nessun pasto")`; crea `SavedWeek` + `SavedWeekItem` con `day_index = (entry.date - start).days`, `meal`, `food_id`, `grams`, `portion_label`, `position`; un solo `commit`; ritorna `SavedWeekSummary` (con `week_stats`). Il nome non è unico.
  2. `list_saved_weeks(db, user)`: query filtrata per `user_id`, ordine `created_at DESC, id DESC`, righe e cibi caricati con `selectinload` (niente N+1), ritorna `list[SavedWeekSummary]`.
  3. `own_saved_week(db, user, id)` (filtra per `user_id`, `selectinload(items).selectinload(food)`) e `get_saved_week` → `SavedWeekDetail` con 7 giorni (anche vuoti: `meals` con le 4 chiavi liste vuote, `total` a zero), totali con `item_day_totals`/`compute_day_totals`.
  4. Router: `POST ""` (201, `SavedWeekSummary`), `GET ""`, `GET "/{saved_week_id}"`; tutti con `require_permission(Permission.diary_copy)`. Includerlo in `main.py` accanto a `weights`.
  5. Test DB (fixture `db`, `make_user`, `make_food`, `http_client` da `api/tests/factories.py`): C1 (pranzo lunedì + cena giovedì → righe a `day_index` 0 e 3 con stessi cibi, grammi e `portion_label`); C2 (settimana vuota → 400 e nessuna riga; `start` non lunedì → 400; nome vuoto o solo spazi → 400); nome con spazi ai bordi salvato senza spazi; due settimane con lo stesso nome ok; C3 (due settimane, ordine più recente prima, `entries_count`); C4 (totali per giorno coerenti con grammi × nutrienti, giorni vuoti con `total.kcal == 0` e `meals` vuoti); C5 (id di un altro utente → 404 su GET); C13 (utente con `permissions=[]` → 403 su POST, GET lista, GET dettaglio).
- Verifica: locale `cd api && .venv/Scripts/python -m ruff check app tests/test_saved_weeks.py && .venv/Scripts/python -c "import app.main" && .venv/Scripts/python -m pytest tests/test_saved_weeks.py --collect-only -q`. Remoto: `docker compose exec api pytest tests/test_saved_weeks.py -v`, tutti verdi.

### [x] T6. Servizio e router: rinomina ed elimina

- Copre: C12 (lato API), C5, C13
- File: `api/app/services/saved_weeks.py` (modifica), `api/app/routers/saved_weeks.py` (modifica), `api/tests/test_saved_weeks.py` (modifica)
- Passi:
  1. `rename_saved_week(db, user, id, payload: SavedWeekRename)`: `ensure_permission`, `own_saved_week`, `clean_name`, `commit`, ritorna `SavedWeekSummary`.
  2. `delete_saved_week(db, user, id)`: `ensure_permission`, `own_saved_week`, `db.delete`, `commit`. Non tocca le `DiaryEntry`.
  3. Router: `PATCH "/{saved_week_id}"` (body `SavedWeekRename`, 200) e `DELETE "/{saved_week_id}"` (204), entrambi con `require_permission(Permission.diary_copy)`.
  4. Test DB: rinomina "Dieta A" → "Dieta B" e l'elenco la mostra; rinomina con nome vuoto → 400; rinomina/elimina di una settimana altrui → 404; elimina → sparisce dall'elenco e dal DB (righe incluse) e le `DiaryEntry` dell'utente (create prima con `POST /api/diary/entries`) restano; 403 senza permesso su PATCH e DELETE.
- Verifica: locale `cd api && .venv/Scripts/python -m ruff check app tests/test_saved_weeks.py && .venv/Scripts/python -c "import app.main"`. Remoto: `docker compose exec api pytest tests/test_saved_weeks.py -v`, verdi.

### [x] T7. Servizio e router: applica al diario

- Copre: C6 (lato API), C7, C8, C9, C11, C13, C14 (dati nuovi leggibili dal diario)
- File: `api/app/services/saved_weeks.py` (modifica), `api/app/routers/saved_weeks.py` (modifica), `api/tests/test_saved_weeks.py` (modifica)
- Contesto: dopo T2 esiste `apply_copy_plan(db, user, plan)` in `api/app/services/diary_ops.py`; dopo T4 esistono `normalize_days` e `plan_apply` in `saved_week_rules.py`. Gli schemi `SavedWeekApply` e `DiaryCopyResponse` sono già definiti.
- Passi:
  1. `apply_saved_week(db, user, id, payload: SavedWeekApply) -> DiaryCopyResponse`: `ensure_permission`, `own_saved_week` (con righe e cibi caricati), `normalize_days(payload.days)`, `plan_apply(week.items, days, payload.target_start, payload.meals, payload.mode)`, `return await diary_ops.apply_copy_plan(db, user, plan)`. Tutto in una transazione (un solo commit dentro `apply_copy_plan`): se `own_saved_week` o la validazione falliscono non si scrive nulla.
  2. Router: `POST "/{saved_week_id}/apply"` (200, `response_model=DiaryCopyResponse`), `require_permission(Permission.diary_copy)`.
  3. Test DB: C6 (apply di tutta la settimana con `days: null` in `append` su 7 giorni vuoti: ogni giorno contiene le entry salvate del giorno corrispondente; `entries_created` e `days` di lunghezza 7); C7 (giorni `[1, 3]`, `target_start=2026-10-12`: martedì → 12, giovedì → 13, nessun altro giorno toccato, anche il giorno 14 resta vuoto); C8 (colazione già presente nel giorno di destinazione: resta, le nuove vanno dopo con `position` successive); C9 (`replace` con `meals=["lunch"]`: pranzi sostituiti, colazione/cena/spuntino restano); `replace` con giorno salvato vuoto svuota comunque i pasti selezionati nel giorno di destinazione; C11 (cambiare `Food.nutriments` dopo il salvataggio: le nuove entry hanno i nutrienti correnti nel `nutriments_snapshot`); `days: []` → 400; giorno 7 → 400; settimana altrui → 404 senza scrivere; 403 senza permesso; equivalenza con la copia: salvare una settimana e copiarne gli stessi giorni con `POST /api/diary/copy` (stessa destinazione in un altro utente/periodo) danno gli stessi `entries_created` per giorno.
- Verifica: locale `cd api && .venv/Scripts/python -m ruff check app tests/test_saved_weeks.py && .venv/Scripts/python -c "import app.main" && .venv/Scripts/python -m pytest tests/test_saved_week_rules.py -q`. Remoto: `docker compose exec api pytest tests/test_saved_weeks.py tests/test_diary_copy.py -v`, verdi.

### [x] T8. Hook web per le settimane salvate

- Copre: C10 (invalidazioni cache), base di C3, C4, C12, C14
- File: `web/src/api/savedWeeks.ts` (nuovo), `web/src/api/savedWeeks.test.tsx` (nuovo)
- Contesto: stile e test di `web/src/api/weights.ts` / `weights.test.tsx` (mock di `fetch` con `vi.stubGlobal`, `renderHook`, `QueryClient` con `retry: false`, spia su `invalidateQueries`). Usare `client` da `web/src/api/client.ts` (prefisso `/api`, header CSRF automatico). Riusare i tipi `Meal`, `Nutriments`, `CopyDaysResponse` da `web/src/api/queries.ts` senza modificarli.
- Passi:
  1. Tipi: `SavedWeekSummary {id, name, created_at, entries_count, avg_kcal}`, `SavedWeekItem`, `SavedWeekDay {day_index, meals: Record<Meal, SavedWeekItem[]>, total: Nutriments}`, `SavedWeekDetail`, `ApplySavedWeekInput {id, days: number[] | null, target_start, meals: Meal[] | null, mode: "append" | "replace"}`.
  2. Chiavi: `savedWeekKeys = { all: ["saved-weeks"], list: ["saved-weeks","list"], detail: (id) => ["saved-weeks","detail",id] }`.
  3. Hook: `useSavedWeeks()` (`GET /saved-weeks`), `useSavedWeek(id)` (`GET /saved-weeks/{id}`, `retry: false` per non ritentare il 404), `useSaveWeek()` (`POST /saved-weeks` con `{name, start}`, invalida `savedWeekKeys.all`), `useRenameSavedWeek()` (`PATCH`, invalida `savedWeekKeys.all`), `useDeleteSavedWeek()` (`DELETE`, invalida `savedWeekKeys.all`), `useApplySavedWeek()` (`POST /saved-weeks/{id}/apply` con `{days, target_start, meals, mode}`, su successo invalida `["diary","week"]` e `["diary","day"]`, come `useCopyDays`).
  4. Test: ogni mutazione manda il metodo, l'URL e il body attesi; salvataggio/rinomina/eliminazione invalidano `["saved-weeks"]`; apply invalida `["diary","week"]` e `["diary","day"]`.
- Verifica: `cd web && npx vitest run src/api/savedWeeks.test.tsx` (verde) e `cd web && npx tsc -b` (nessun errore).

### [x] T9. Estrarre `CopyOptionsFields` da `CopyDaysDialog` (nessun cambio visibile)

- Copre: C15 (preservare), base di C6/C10
- File: `web/src/components/CopyOptionsFields.tsx` (nuovo), `web/src/components/CopyOptionsFields.test.tsx` (nuovo), `web/src/components/CopyDaysDialog.tsx` (modifica)
- Contesto: `CopyDaysDialog` contiene oggi i tre blocchi di form (input data `id="copy-target-start"` con label "Data di inizio"; fieldset "Pasti" con una checkbox per `MEALS` con `aria-label={MEAL_LABELS[meal]}`; fieldset "Modalità" con radio `name="copy-mode"` "Aggiungi / Mantiene i pasti già presenti" e "Sostituisci / Cancella i pasti già presenti"). `MEAL_LABELS` è in `web/src/lib/meals.ts`. I test `web/src/components/CopyDaysDialog.test.tsx` e `web/src/pages/WeekPage.test.tsx` non devono essere modificati.
- Passi:
  1. Creare `CopyOptionsFields` (presentazionale, controllato) con props `targetStart`, `onTargetStartChange`, `selectedMeals`, `onToggleMeal`, `mode`, `onModeChange`. Contiene esattamente i tre blocchi sopra, con le stesse classi, etichette, id e name.
  2. Sostituire quei blocchi in `CopyDaysDialog.tsx` con `<CopyOptionsFields ... />`. Stato, `useCopyDays`, `handleSubmit`, messaggio d'errore, riepilogo e footer restano in `CopyDaysDialog` com'erano.
  3. Test del nuovo componente: rende la data, le 4 checkbox dei pasti (tutte spuntate se passate così), le due modalità con le descrizioni; i callback ricevono i cambi.
- Verifica: `cd web && npx vitest run src/components/CopyDaysDialog.test.tsx src/pages/WeekPage.test.tsx src/components/CopyOptionsFields.test.tsx` (verdi, i primi due senza modifiche ai file di test) e `cd web && npx tsc -b`.

### [x] T10. `ApplySavedWeekDialog` (bottom sheet di applicazione)

- Copre: C6 (UI), C10
- File: `web/src/components/ApplySavedWeekDialog.tsx` (nuovo), `web/src/components/ApplySavedWeekDialog.test.tsx` (nuovo)
- Contesto: struttura e classi da copiare da `CopyDaysDialog.tsx` (overlay `fixed inset-0 z-50`, sheet `rounded-t-sheet`, grabber, footer con `pb-[calc(0.75rem+var(--safe-bottom))]`, target 44 px, `role="dialog"`, pulsanti `btn-primary`/`btn-secondary`). Test da imitare: `CopyDaysDialog.test.tsx` (mock di `useCopyDays` con `vi.mock("../api/queries", ...)`); qui il mock è di `useApplySavedWeek` da `../api/savedWeeks`.
- Passi:
  1. Props: `savedWeekId: number`, `days: number[] | null` (null = intera settimana), `onClose`. Titolo "Applica settimana" se `days` è null, altrimenti "Applica N giorni"/"Applica 1 giorno"; `aria-label="Applica settimana"` sul dialog.
  2. Stato locale `targetStart` (vuoto), `selectedMeals` (tutti), `mode` ("append"); campi tramite `CopyOptionsFields`.
  3. Submit: se `targetStart` vuoto, nessun pasto selezionato o mutazione in corso, non fa nulla; altrimenti `mutate({ id: savedWeekId, days, target_start, meals: tutti ? null : selectedMeals, mode })`. Pulsante "Applica" disabilitato nelle stesse condizioni (C10).
  4. Successo: `role="status"` con "Applicati N pasti in M giorni." (singolari "pasto" e "giorno" quando 1, come in `CopyDaysDialog`) e pulsante "Chiudi". Errore: `role="alert"` "Errore durante l'applicazione della settimana.". `handleClose` fa `reset()` e `onClose()`.
  5. Test: submit con tutti i pasti → `meals: null`; sottoinsieme pasti → array; modalità replace; "Applica" disabilitato senza data e con zero pasti (C10); riepilogo "Applicati 5 pasti in 2 giorni"; Annulla chiama `onClose`.
- Verifica: `cd web && npx vitest run src/components/ApplySavedWeekDialog.test.tsx` (verde) e `cd web && npx tsc -b`.

### [x] T11. Pagina elenco `/week/saved` e rotta

- Copre: C3, C13 (web), C18
- File: `web/src/pages/SavedWeeksPage.tsx` (nuovo), `web/src/pages/SavedWeeksPage.test.tsx` (nuovo), `web/src/App.tsx` (modifica), `web/src/components/AppShell.test.tsx` (modifica: un test in più)
- Contesto: layout di pagina da `web/src/pages/WeekPage.tsx` (`<header className="app-header">` con `<ModeSwitch />`, contenuto `mx-auto max-w-2xl space-y-4 p-4`, classi `card`, `section-label`). Guardia: `web/src/auth/PermissionGuard.tsx` (reindirizza a `/`). `AppShell` ha la tab Settimana come `NavLink to="/week"` senza `end`; `modeFromPath` in `web/src/lib/appMode.ts` tratta `/week*` come dieta: nessuna modifica a questi due file.
- Passi:
  1. `SavedWeeksPage`: header con `ModeSwitch`, pulsante indietro `‹ Settimana` (`Link` a `/week`) e titolo "Settimane salvate". Con `useSavedWeeks`: lista di `Link` a `/week/saved/${id}` come card con nome, data di salvataggio (`formatIsoDateShort` da `web/src/lib/date.ts` sui primi 10 caratteri di `created_at`), "N pasti" e "~K kcal/giorno" (`Math.round(avg_kcal)`). Stato di caricamento ed errore come in `WeekPage`. Stato vuoto: testo "Nessuna settimana salvata." con `Link` "Vai a Settimana" verso `/week`.
  2. `App.tsx`: dentro `<Route element={<AppShell />}>`, aggiungere `<Route element={<PermissionGuard permission="diary.copy" />}><Route path="/week/saved" element={<SavedWeeksPage />} /></Route>` (la rotta `/week` resta com'è).
  3. `AppShell.test.tsx`: aggiungere `<Route path="/week/saved" ...>` a `renderShell` e un test che con `initialPath="/week/saved"` il link "Settimana" ha `aria-current="page"` e le 4 tab restano Giorno, Cerca, Settimana, Statistiche (C18). Non toccare gli altri test.
  4. Test della pagina (mock di `../api/savedWeeks` e di `../components/ModeSwitch`, `MemoryRouter`): due settimane in ordine con nome e "N pasti"; stato vuoto con link a `/week`; con `PermissionGuard` e `useHasPermission` mockato a `false` (mock di `../auth/AuthContext` come in `AppShell.test.tsx`) la rotta reindirizza alla pagina "Giorno" (C13).
- Verifica: `cd web && npx vitest run src/pages/SavedWeeksPage.test.tsx src/components/AppShell.test.tsx` (verdi) e `cd web && npx tsc -b`.

### [x] T12. Pagina dettaglio `/week/saved/:id` (sola lettura)

- Copre: C4 (UI), C5 (UI), C13 (web)
- File: `web/src/pages/SavedWeekDetailPage.tsx` (nuovo), `web/src/pages/SavedWeekDetailPage.test.tsx` (nuovo), `web/src/App.tsx` (modifica)
- Contesto: la griglia dei giorni imita `DayCell` di `WeekPage.tsx` (kcal e macro per giorno, `Prot.`/`Carb.`/`Grassi` con `Math.round`), senza colori contro obiettivo e senza checkbox in questo task. Etichette `Lun…Dom` per indice come `WEEKDAY_LABELS` in `WeekPage.tsx`; pasti raggruppati con `MEAL_LABELS` (`web/src/lib/meals.ts`) e `MEALS` da `web/src/api/queries.ts`. Gestione 404 come `WorkoutDetailPage.tsx` (`isError` → "Allenamento non trovato.").
- Passi:
  1. `SavedWeekDetailPage`: `useParams` → `Number(id)`, `useSavedWeek(id)`. Header con `ModeSwitch`, pulsante `‹ Salvate` verso `/week/saved`, titolo con il nome. Per ogni giorno: etichetta (Lun…Dom), kcal e macro, poi i pasti non vuoti con le righe "nome cibo — N g" (con `portion_label` se presente); giorno senza pasti: testo "Nessun pasto". `isError` (404 o altro) → card "Settimana non trovata.".
  2. `App.tsx`: aggiungere `<Route path="/week/saved/:id" element={<SavedWeekDetailPage />} />` dentro il `PermissionGuard permission="diary.copy"` creato in T11.
  3. Test (mock di `../api/savedWeeks`, `ModeSwitch`): 7 giorni Lun…Dom, kcal e macro del giorno, cibi per pasto con i grammi, giorno vuoto con "Nessun pasto"; `isError: true` → "Settimana non trovata.".
- Verifica: `cd web && npx vitest run src/pages/SavedWeekDetailPage.test.tsx` (verde) e `cd web && npx tsc -b`.

### [~] T13. Dettaglio: selezione giorni, "Applica settimana…" e barra "Applica N giorni…"

- Copre: C6, C7, C10 (nel flusso), C14
- File: `web/src/pages/SavedWeekDetailPage.tsx` (modifica), `web/src/pages/SavedWeekDetailPage.test.tsx` (modifica)
- Contesto: barra fissa da copiare da `WeekPage.tsx`: `fixed inset-x-0 bottom-[var(--nav-height)] z-40 flex justify-center border-t border-slate-200/80 bg-white/90 p-3 shadow-sheet backdrop-blur-xl`, pulsante `btn-primary w-full max-w-sm`. Checkbox per giorno come in `DayCell` (`aria-label` per giorno, target `min-h-[44px]`). `ApplySavedWeekDialog` da T10 (props `savedWeekId`, `days`, `onClose`).
- Passi:
  1. Stato `selected: Set<number>` (per `day_index`), checkbox per giorno con `aria-label={`Seleziona ${etichetta}`}` (es. "Seleziona Mar").
  2. Pulsante "Applica settimana…" sempre visibile in pagina (sotto l'header o in testa al contenuto): apre `ApplySavedWeekDialog` con `days: null`.
  3. Con `selected.size > 0`: barra fissa con "Applica N giorni…"/"Applica 1 giorno…" che apre il dialog con `days: Array.from(selected).sort((a, b) => a - b)`. Alla chiusura del dialog la selezione si azzera (come `handleCloseDialog` in `WeekPage`).
  4. Test: "Applica settimana…" apre il dialog `Applica settimana`; spuntare Mar e Gio mostra "Applica 2 giorni…" e il dialog, confermando con data `2026-10-12`, chiama `mutate` con `days: [1, 3]`, `target_start: "2026-10-12"` (C7); la barra ha classi `bottom-[var(--nav-height)]` e `z-40`, senza `bottom-0`; senza selezione la barra non c'è.
- Verifica: `cd web && npx vitest run src/pages/SavedWeekDetailPage.test.tsx src/components/ApplySavedWeekDialog.test.tsx` (verdi) e `cd web && npx tsc -b`.

### [ ] T14. Dettaglio: rinomina ed elimina

- Copre: C12 (UI)
- File: `web/src/pages/SavedWeekDetailPage.tsx` (modifica), `web/src/pages/SavedWeekDetailPage.test.tsx` (modifica)
- Contesto: pattern di `web/src/pages/gym/WorkoutDetailPage.tsx`: `ActionMenu` da `web/src/components/gym/ActionMenu.tsx` con `actions=[{ label, onSelect, destructive? }]`, `window.prompt` per il nome, `window.confirm` prima di eliminare, `navigate(..., { replace: true })` dopo il successo.
- Passi:
  1. Nell'header `ActionMenu` con `label="Azioni settimana"` e due azioni: "Rinomina" (`window.prompt("Nome della settimana", week.name)?.trim()`; se non vuoto e diverso → `useRenameSavedWeek().mutate({ id, name })`; se annullato o vuoto non succede nulla) e "Elimina" (destructive).
  2. "Elimina": `window.confirm("Eliminare questa settimana salvata?")`; se annullato non succede nulla; se confermato `useDeleteSavedWeek().mutate(id, { onSuccess: () => navigate("/week/saved", { replace: true }) })`.
  3. Test (spie su `window.prompt` e `window.confirm`): rinomina chiama `mutate` con il nuovo nome; prompt annullato → nessuna chiamata; elimina con conferma → `mutate` chiamato e navigazione a `/week/saved`; elimina con conferma negata → nessuna chiamata.
- Verifica: `cd web && npx vitest run src/pages/SavedWeekDetailPage.test.tsx` (verde) e `cd web && npx tsc -b`.

### [ ] T15. `SaveWeekDialog` (salvataggio con nome)

- Copre: C1 (UI), C2 (UI)
- File: `web/src/components/SaveWeekDialog.tsx` (nuovo), `web/src/components/SaveWeekDialog.test.tsx` (nuovo)
- Contesto: stesso aspetto bottom sheet di `CopyDaysDialog.tsx`; errori dell'API come `ApiError` (`web/src/api/client.ts`, `.message` contiene il `detail` del server, es. settimana senza pasti). Hook `useSaveWeek` da T8.
- Passi:
  1. Props: `start: string` (lunedì), `onClose`, `onSaved?`. Campo testo "Nome" (`maxLength={100}`, label associata), pulsanti "Annulla" e "Salva". `role="dialog"` con `aria-label="Salva settimana"`.
  2. "Salva" disabilitato se il nome tagliato è vuoto o la mutazione è in corso. Submit: `mutate({ name: name.trim(), start })`.
  3. Errore: `role="alert"` con `error.message` se è un `ApiError`, altrimenti "Errore durante il salvataggio della settimana.". Successo: `role="status"` "Settimana salvata." con pulsante "Chiudi" (e `onSaved?.()`).
  4. Test: invio con nome valido chiama `mutate` con nome senza spazi e `start`; "Salva" disabilitato con nome vuoto/spazi; errore mostrato; Annulla chiama `onClose`.
- Verifica: `cd web && npx vitest run src/components/SaveWeekDialog.test.tsx` (verde) e `cd web && npx tsc -b`.

### [ ] T16. `WeekPage`: comandi "Salva settimana" e "Settimane salvate"

- Copre: C1 (UI), C3 (accesso), C13 (web), C15
- File: `web/src/pages/WeekPage.tsx` (modifica), `web/src/pages/WeekPage.test.tsx` (modifica: solo test aggiunti)
- Contesto: `WeekPage` calcola `start` da `?start=` (default `startOfWeek(todayIso())` da `web/src/lib/date.ts`; un `start` non lunedì è accettato dalla pagina). `useHasPermission` da `web/src/auth/AuthContext.tsx` (senza provider restituisce `false`, quindi i test esistenti di `WeekPage.test.tsx` passano senza modifiche). Per testare i comandi, mockare `../auth/AuthContext` in un `describe` o file separato solo per i nuovi test (vedi il mock in `AppShell.test.tsx`), senza cambiare i test esistenti.
- Passi:
  1. Calcolare `canCopy = useHasPermission("diary.copy")` e `isMonday = startOfWeek(start) === start`.
  2. Sotto l'header, dentro `data &&`, se `canCopy`: riga con `Link` "Settimane salvate" (verso `/week/saved`, target 44 px) e, solo se `isMonday`, pulsante "Salva settimana" che apre `SaveWeekDialog` con `start`. Se `start` non è lunedì, il pulsante non c'è.
  3. Non modificare la griglia, la barra "Copia N giorni…", il ⋯ per giorno, `CopyDaysDialog` né il reset della selezione.
  4. Test aggiunti: con permesso e lunedì i due comandi ci sono e "Salva settimana" apre il dialog; senza permesso nessuno dei due; con permesso ma `?start=2026-08-25` (martedì) "Salva settimana" non c'è e "Settimane salvate" sì.
- Verifica: `cd web && npx vitest run src/pages/WeekPage.test.tsx src/components/SaveWeekDialog.test.tsx` (verdi, i test preesistenti di `WeekPage` senza modifiche) e `cd web && npx tsc -b`.

### [ ] T17. Documentazione e verifica finale

- Copre: C19, C20 (e riepilogo C1–C18)
- File: `README.md` (modifica)
- Passi:
  1. Tabella API (sezione con `/api/diary/copy`, riga 173 circa): aggiungere le righe `POST /api/saved-weeks`, `GET /api/saved-weeks`, `GET /api/saved-weeks/{id}`, `PATCH /api/saved-weeks/{id}`, `DELETE /api/saved-weeks/{id}`, `POST /api/saved-weeks/{id}/apply`, nello stesso formato, indicando che richiedono `diary.copy`.
  2. "Known gaps": lasciare la riga su `meal_template` (modello senza API né UI) e aggiungere una frase che le settimane salvate sono una funzione a parte che non usa `meal_template`.
  3. Eseguire la suite web e la build, poi il push del branch e la corsa completa sul server.
- Verifica: locale `cd web && npm test` (tutti verdi, C19) e `cd web && npm run build` (nessun errore TypeScript); locale `cd api && .venv/Scripts/python -m ruff check . && .venv/Scripts/python -m pytest tests/test_saved_week_rules.py tests/test_diary_copy_service.py -q`. Remoto: `git push` del branch `feature/settimane-pasti-salvate`, `git pull` sul server, `docker compose exec api alembic upgrade head`, poi `docker compose exec api pytest -v` (C20: suite completa verde, compresi `test_saved_weeks.py`, `test_saved_week_models.py`, `test_diary_copy.py`, `test_diary_copy_permission.py`, `test_mcp_tools_diary.py`). Controllo manuale su iPhone/PWA, se possibile: salva una settimana, aprila, applicala in `append` e in `replace`, verifica che Giorno e Settimana mostrino subito i dati (C14), che la barra "Applica N giorni…" stia sopra la tab bar e che con un utente senza `diary.copy` non compaiano i comandi.

## Copertura dei criteri

C1 T3, T5, T15, T16 · C2 T4, T5, T15 · C3 T5, T11, T16 · C4 T4, T5, T12 · C5 T5, T6, T12 · C6 T7, T10, T13 · C7 T4, T7, T13 · C8 T7 · C9 T7 · C10 T10, T13 · C11 T4, T7 · C12 T3, T6, T14 · C13 T5, T6, T7, T11, T16 · C14 T7, T8, T13, T17 (manuale) · C15 T1, T2, T9, T16 · C16 T1, T2 · C17 T1, T2 · C18 T11 · C19 T17 · C20 T17

## Domande aperte

Nessuna bloccante. Scelte del piano da confermare in review: nome non valido come 400 (non 422); `CheckConstraint` 0..6 su `day_index` oltre a quanto elencato nella spec; rinomina via `window.prompt` (precedente di `WorkoutDetailPage`) invece di un bottom sheet.

## Registro di esecuzione

Commit di partenza: 7a42eed

- T1 — DONE — review: 1 round — commit: c744368 (MINOR: date().isoformat inutile, entries_created non asserito)
- T2 — DONE — review: 1 round — commit: a6ab0b1 (MINOR: firma su 3 righe)
- T3 — DONE — review: 1 round — commit: 699d45b (MINOR: ruff format su CheckConstraint migrazione; test DB da eseguire sul remoto)
- T4 — DONE — review: 1 round — commit: bb4994e (MINOR: ciclo morto in plan_apply righe 80-81; equivalenza test non confronta inserts)
- T5 — DONE — review: 2 round (BLOCKER total dettaglio risolto; MAJOR avg_kcal test corretto, verificato dall'orchestratore) — commit: f6b86d4 (test DB da eseguire sul remoto)
- T6 — DONE — review: 1 round — commit: f835cb8 (MINOR: 2 asserzioni opzionali nei test)
- T7 — DONE — review: 1 round — commit: 5db4223 (MINOR: test equivalenza usa stesso utente)
- T8 — DONE — review: 1 round — commit: bc86cb2 (MINOR: test apply con days/meals null mancante)
- T9 — DONE — review: 1 round — commit: c3d67ab
- T10 — DONE — review: 1 round — commit: b170175 (MINOR: test titoli/isPending/singolari mancanti)
- T11 — DONE — review: 1 round — commit: 7e99dbb (MINOR: manca test loading/error; '1 pasti' al singolare)
- T12 — DONE — review: 1 round — commit: d9bea81 (MINOR: cast nei test)
