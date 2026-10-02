# Piano: Statistiche palestra e peso giornaliero

- Data: 2026-10-02
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: feature
- Branch: feature/statistiche-palestra-peso

## Approccio

Il piano segue l'approccio A della spec e l'[ADR 0002](../../decisions/0002-statistiche-lato-server-condivise-web-mcp.md): ogni metrica è calcolata una sola volta nell'API e letta sia dagli endpoint REST sia dai tool MCP. Ordine: test di caratterizzazione sul web, regole pure dell'API, modello e migrazione delle pesate, servizi ed endpoint (peso, statistiche palestra, progressione), tool MCP, poi il web (hook, grafiche placeholder, tasto peso, badge palestra, pagina Statistiche Palestra, blocco peso in Statistiche Dieta, swipe nello Storico), i prompt delle grafiche, il deploy remoto e la verifica su iPhone.

**API.**
- Le regole senza DB vanno in un modulo nuovo `api/app/services/stats_rules.py`, sul modello di `api/app/services/gym_rules.py`: validazione del periodo, parsing del peso, Epley, metriche per sessione secondo il `Tracking`, record personali, settimane ISO, frequenza, media mobile a 7 giorni e medie settimanali. Sono testate in `api/tests/test_stats_rules.py`, che gira in locale come `test_gym_rules.py` e `test_streak.py`.
- I servizi DB (`api/app/services/weights.py`, `api/app/services/gym_stats.py`) fanno poche query filtrate per `user_id` e passano le righe alle funzioni pure. Il giorno di un allenamento è `timezone(app_timezone, started_at)::date`; il giorno di "oggi" del peso usa `activity.local_today()` di `api/app/services/activity.py`.
- Gli errori seguono `api/app/services/errors.py`: `Invalid` → 400, `NotFound` → 404, `PermissionMissing` → 403 (handler in `api/app/main.py`), e nei tool MCP diventano `ToolError` tramite `tool_scope` di `api/app/mcp/context.py`. Il permesso palestra si controlla con `ensure_permission(user, Permission.workouts)` nei servizi, come in `list_history`.
- Il valore del peso deve dare 400 anche se non numerico (R3), quindi lo schema accetta un valore qualsiasi e la validazione è nel servizio (`Invalid`), non in un vincolo pydantic (che darebbe 422).
- Nomi dei parametri del periodo: `start` e `end` (date ISO incluse), sia in REST (come `GET /api/diary/range`) sia nei tool MCP. La spec scrive `from`/`to`, ma `from` è una parola riservata in Python e l'SDK MCP 2.2 passa al tool gli argomenti con il nome dell'alias (`func_metadata.model_dump_one_level`), quindi un alias `from` non funziona. Vedi Domande aperte.
- Endpoint nuovi (tutti dietro `get_current_user`, scritture soggette al middleware CSRF di `main.py`):
  - `GET /api/weights/today` → pesata di oggi o 204; `PUT /api/weights/today` `{weight_kg}` → pesata salvata; `GET /api/weights?start&end` → giorni e settimane; `DELETE /api/weights/{id}` → 204;
  - `GET /api/stats/gym/count`, `GET /api/stats/gym?start&end`, `GET /api/stats/gym/exercises`, `GET /api/stats/gym/exercises/{exercise_id}?start&end` (in `api/app/routers/stats.py`, accanto a `/stats/streak`).
- Verifica API in locale (niente Postgres): `ruff`, import di `app.main`, `pytest tests/test_stats_rules.py`, `pytest --collect-only`, `alembic upgrade --sql` offline. I test DB si scrivono nei task ma girano solo sul deploy remoto in T17. Nessun task dichiara verdi test DB eseguiti in locale.

**Web.**
- Hook nuovi in `web/src/api/weights.ts` (chiavi sotto `["weight"]`) e in `web/src/api/gym.ts` (chiavi sotto `["gym", "stats"]`). `useDeleteWorkout` e la mutation di fine allenamento invalidano anche `["gym", "stats"]`.
- Il tasto peso vive dentro `ModeSwitch` (`web/src/components/ModeSwitch.tsx`), simmetrico a `SettingsButton`, e compare solo dove `modeFromPath(pathname) !== null`. L'overlay e i suoi hook TanStack Query sono montati solo quando è aperto: così i test esistenti che renderizzano `ModeSwitch` senza `QueryClientProvider` (es. `DayPage.test.tsx`) restano verdi.
- La lettura del periodo dal query string, oggi `readChoice` dentro `DietStatsPage.tsx`, passa in un hook condiviso che preserva gli altri parametri (serve a `exercise` in Statistiche Palestra). `PeriodPicker` e `validateCustomPeriod` di `web/src/lib/stats.ts` si riusano invariati.
- `BadgeGrid` e `badgeProgress` si generalizzano con un parametro opzionale; i valori di default restano quelli della Dieta, così `StreakCard.test.tsx`, `BadgeGrid.test.tsx` e `badges.test.ts` restano invariati (C17).
- I grafici nuovi sono SVG fatti a mano sul modello di `web/src/components/stats/KcalChart.tsx` (viewBox 320×160, `labelStep`).
- Lo swipe usa eventi touch (`touchstart`/`touchmove`/`touchend`), simulabili in jsdom con `fireEvent.touchStart(el, { touches: [{ clientX, clientY }] })`, e `touch-action: pan-y` sulla card: lo scroll verticale resta al browser.
- Grafiche: le sorgenti placeholder vanno in `web/art/{dieta,palestra}/` e passano dalla pipeline `web/scripts/build-art.py`, che produce i file serviti in `web/public/art/{diet,gym}/`. Percorsi letti da `web/src/lib/art.ts`.

**Copertura attuale.** `ModeSwitch.test.tsx`, `AppShell.test.tsx`, `appMode.test.ts`, `StreakCard.test.tsx`, `BadgeGrid.test.tsx`, `badges.test.ts`, `DietStatsPage.test.tsx`, `charts.test.tsx`, `stats.test.ts`, `GoalForm.test.tsx` coprono già i comportamenti da preservare lato header, badge Dieta e statistiche Dieta. Mancano: un test di `HistoryPage` (nessun file) e il flusso "Elimina" di `WorkoutDetailPage.test.tsx` (che copre solo i modelli). `GymStatsPage` non ha test, ma il suo contenuto attuale viene sostituito per intero. Lato API, `test_gym_routers.py` e `test_workouts_finish.py` (`test_history_pages_and_delete`) coprono già `DELETE /api/workouts/{id}` e lo storico (C23). T1 scrive i test di caratterizzazione mancanti sul web.

**Commit.** Un commit per task, messaggio `<tipo>(statistiche-palestra-peso): <cosa>` (es. `feat`, `test`, `docs`), con la riga di attribuzione richiesta dal progetto.

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Test di caratterizzazione: Storico ed eliminazione dal dettaglio

- Copre: C21, C22 (comportamento attuale), C28
- File: `web/src/pages/gym/HistoryPage.test.tsx` (nuovo), `web/src/pages/gym/WorkoutDetailPage.test.tsx` (modifica)
- Passi:
  1. Verificare di essere su `feature/statistiche-palestra-peso` (`git branch --show-current`).
  2. Creare `HistoryPage.test.tsx` mockando `useHistory` di `../../api/gym` (stesso schema di `WorkoutDetailPage.test.tsx`) e `../../components/ModeSwitch` con un segnaposto. Casi:
     - tre allenamenti in due mesi diversi: compaiono due intestazioni di mese (`monthLabel`) e le card nell'ordine ricevuto;
     - ogni card è un link a `/gym/history/:id`; un click su una card in `MemoryRouter` con una route `/gym/history/:id` mostra la pagina di destinazione;
     - con `hasNextPage: true` il pulsante "Carica altri" chiama `fetchNextPage`; con `false` non c'è;
     - lista vuota: "Nessun allenamento completato.".
  3. In `WorkoutDetailPage.test.tsx`, senza toccare i casi esistenti, aggiungere il flusso "Elimina": aprire `ActionMenu`, scegliere "Elimina" con `vi.spyOn(window, "confirm")` che restituisce `true` → `mutate` di `useDeleteWorkout` chiamato con l'id e, al successo, navigazione a `/gym/history`; con `false` nessuna chiamata. Prima leggere `WorkoutDetailPage.tsx` per replicare esattamente come chiama la mutation (callback `onSuccess` o `mutateAsync`).
- Verifica: `cd web && npx vitest run src/pages/gym/HistoryPage.test.tsx src/pages/gym/WorkoutDetailPage.test.tsx`, risultato atteso: tutti verdi sul codice attuale. Poi `cd web && npm test`: suite verde.

### [x] T2. Regole pure delle statistiche nell'API

- Copre: C3 (arrotondamento e intervallo del peso), C4, C9, C10 (parte senza DB), definizioni delle metriche
- File: `api/app/services/stats_rules.py` (nuovo), `api/tests/test_stats_rules.py` (nuovo)
- Passi:
  1. In `stats_rules.py` (nessun accesso al DB, nessun import di sessioni) definire:
     - `MAX_RANGE_DAYS = 366`, `check_period(start, end)`: `Invalid` se `end < start` o se supera 366 giorni (stessi messaggi di `diary_ops.get_range`);
     - `WEIGHT_MIN = Decimal("20.0")`, `WEIGHT_MAX = Decimal("400.0")`, `parse_weight(value: Any) -> Decimal`: accetta int, float o stringa numerica (anche con virgola), rifiuta bool, None e testo non numerico con `Invalid("weight must be a number")`, arrotonda a 1 decimale con `ROUND_HALF_UP` (78.46 → 78.5) e poi controlla l'intervallo inclusivo (19.9 e 400.1 → `Invalid`);
     - `epley_1rm(weight, reps) -> float | None`: `None` se peso o reps mancano o sono ≤ 0; `weight` se `reps == 1`; altrimenti `weight × (1 + reps/30)`; arrotondato a 1 decimale (100×5 → 116.7, 105×1 → 105.0);
     - `iso_weeks(start, end) -> list[date]`: i lunedì delle settimane ISO che intersecano il periodo;
     - `weekly_frequency(workout_days, start, end) -> list[tuple[date, int]]`: conteggio per settimana ISO, con gli zeri;
     - `moving_average_7d(weights: dict[date, Decimal], day) -> float | None` (pesate da `day−6` a `day`, 1 decimale);
     - `weekly_weight_averages(weights, start, end) -> list[WeekAverage]` (`week_start`, `avg_kg`, `count`, `change_kg`), media su tutta la settimana ISO, variazione rispetto alla settimana ISO precedente, `None` se una delle due è vuota;
     - `SessionSet` (weight_kg, reps, duration_s) e `session_metrics(tracking, sets) -> dict[str, float | int]` secondo le definizioni della spec: `weight_reps` → `max_weight_kg`, `max_1rm_kg`, `volume_kg`; `reps` → `max_reps`, `total_reps` più `max_weight_kg` e `volume_kg` solo se almeno una serie ha zavorra; `duration` → `max_duration_s`, `total_duration_s`. Volume = somma di `weight × reps` sulle serie con entrambi, 1 decimale;
     - `personal_records(tracking, sessions: list[tuple[date, list[SessionSet]]]) -> list[Record]` (`kind`, `value`, `date`), sulla prima sessione a parità di valore: `weight_reps` → `max_weight_kg`, `max_1rm_kg`, `max_reps`; `reps` → `max_reps` (+ `max_weight_kg` con zavorra); `duration` → `max_duration_s`.
  2. `test_stats_rules.py` (senza DB, eseguibile in locale) con casi tabellari:
     - `parse_weight`: "78,4", 78.46 → 78.5, 20, 400, 19.9, 400.1, "abc", True, None;
     - `check_period`: `end < start`, 366 giorni ok, 367 giorni errore;
     - `epley_1rm`: 100×5, 105×1, peso 0, reps 0, `None`;
     - media mobile con pesate 1, 3 e 8 ottobre: il 7 media di 1 e 3, l'8 media di 3 e 8, il 10 solo l'8, un giorno senza pesate nei 7 giorni precedenti → `None` (C4);
     - medie settimanali su settimana ISO intera con variazione nulla se la precedente è vuota;
     - frequenza su un periodo di tre settimane con una settimana vuota a zero;
     - metriche e record per i tre tracking, inclusi i numeri di C9 (100×5 + 80×8 → volume 1140; serie `reps` senza peso e a durata contribuiscono 0) e di C10 (record 105 kg, 116.7, 5 reps con le date giuste; parità → prima data).
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_stats_rules.py -q`: verde in locale.

### [x] T3. Modello delle pesate e migrazione

- Copre: C3 (una riga per giorno), C29 (migrazione e downgrade)
- File: `api/app/models/weight.py` (nuovo), `api/app/models/__init__.py` (modifica), `api/alembic/versions/a6c1e4b8d203_body_weights.py` (nuovo), `api/tests/test_weight_models.py` (nuovo)
- Passi:
  1. Creare `BodyWeight`, tabella `body_weights`: `id` (PK intero), `user_id` (FK `users.id` `ondelete="CASCADE"`, non null), `date` (`sa.Date`, non null), `weight_kg` (`sa.Numeric(4, 1)`, non null), `created_at` (`server_default=now()`), `UniqueConstraint("user_id", "date", name="uq_body_weights_user_date")`. Il vincolo unico fa anche da indice per le letture per periodo. Esportare la classe in `app/models/__init__.py` (import e `__all__`).
  2. Migrazione `a6c1e4b8d203` con `down_revision = "e3f9b2a7c514"`, sul modello di `d5e8a1c3f720_user_activity_days.py`: `upgrade` crea la tabella con il vincolo; `downgrade` la elimina. Nessuna migrazione di dati, nessun indice in più (ADR 0002: indici solo se servono).
  3. `test_weight_models.py` (DB, remoto): due righe con stesso utente e data sollevano `IntegrityError`; eliminare l'utente elimina le sue pesate. Usare `make_user` di `tests/factories.py`.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -c "import app.main"`: nessun errore;
  - `.venv/Scripts/python -m alembic upgrade e3f9b2a7c514:a6c1e4b8d203 --sql`: stampa `CREATE TABLE body_weights` con il vincolo unico; `.venv/Scripts/python -m alembic downgrade a6c1e4b8d203:e3f9b2a7c514 --sql`: stampa `DROP TABLE body_weights`;
  - `.venv/Scripts/python -m pytest --collect-only -q`: nessun errore di import.

  I test DB vengono eseguiti in T17.

### [x] T4. Servizio ed endpoint del peso

- Copre: C3, C4, C5, C26 (peso), R6
- File: `api/app/schemas/weight.py` (nuovo), `api/app/services/weights.py` (nuovo), `api/app/routers/weights.py` (nuovo), `api/app/main.py` (modifica), `api/tests/test_weights.py` (nuovo)
- Passi:
  1. Schemi: `WeightIn(weight_kg: Any)`; `WeightOut(id, date, weight_kg: float)`; `WeightDayOut(date, id: int | None, weight_kg: float | None, avg_7d_kg: float | None)`; `WeightWeekOut(week_start, avg_kg: float | None, count: int, change_kg: float | None)`; `WeightHistoryOut(start, end, days: list[WeightDayOut], weeks: list[WeightWeekOut])`.
  2. Servizio `weights.py` (ogni query con `BodyWeight.user_id == user.id`):
     - `log_today(db, user, value) -> WeightOut`: `parse_weight`, giorno = `activity.local_today()`, upsert con `sqlalchemy.dialects.postgresql.insert(...).on_conflict_do_update(constraint="uq_body_weights_user_date", set_={"weight_kg": ...})`, commit;
     - `get_today(db, user) -> WeightOut | None`;
     - `delete_weight(db, user, weight_id)`: `NotFound("weight not found")` se la riga non è dell'utente;
     - `weight_history(db, user, start, end) -> WeightHistoryOut`: `check_period`, una query su `[min(start − 6, lunedì(start) − 7), domenica(end)]`, poi `moving_average_7d` per ogni giorno del periodo e `weekly_weight_averages` per le settimane.
  3. Router `weights.py` con prefisso `/api/weights`: `GET /today` (200 o 204), `PUT /today` (200), `GET ""` con `start`, `end` (`Query`), `DELETE /{weight_id}` (204). Registrarlo in `main.py` con `dependencies=[Depends(get_current_user)]`. Nessun permesso oltre l'autenticazione.
  4. `test_weights.py` (DB, remoto), con `http_client` di `tests/factories.py`:
     - C3: due `PUT /today` (78.0 e 78.46) → una riga con 78.5; con `monkeypatch` su `weights.local_today` (o sull'orologio usato dal servizio) a "2026-10-01T23:30Z" la riga va al 2 ottobre con `app_timezone=Europe/Rome`; 19.9, 400.1 e "abc" → 400; `PUT` con `http_client(..., csrf=False)` → 403;
     - C4: pesate inserite direttamente l'1, 3 e 8 ottobre, `GET /api/weights?start=2026-10-07&end=2026-10-10` → quattro giorni con i valori attesi e le settimane ISO 5–11 ottobre (variazione rispetto a 28 set–4 ott) e, in un secondo caso, variazione nulla con la settimana precedente vuota;
     - C5: `DELETE` della propria pesata → 204; della pesata di bob → 404 e la riga resta; `start > end` e 367 giorni → 400;
     - C26: con alice e bob con pesate, le risposte di alice non contengono valori di bob; senza login → 401.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -c "import app.main"`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_stats_rules.py -q`: verde;
  - `.venv/Scripts/python -m pytest tests/test_weights.py --collect-only -q`: raccoglie i test.

  Esecuzione reale in T17.

### [~] T5. Statistiche palestra del periodo e conteggio allenamenti

- Copre: C9, C26 (palestra), R7 (dato), R14 (parte), C18 (nessuna modifica a serie e attività)
- File: `api/app/schemas/stats.py` (modifica), `api/app/services/gym_stats.py` (nuovo), `api/app/routers/stats.py` (modifica), `api/tests/factories.py` (modifica), `api/tests/test_gym_stats.py` (nuovo)
- Passi:
  1. Schemi in `schemas/stats.py` (senza toccare `StreakOut`): `GymCountOut(finished: int)`; `GymWeekOut(week_start, workouts)`; `GymStatsOut(start, end, workouts, volume_kg: float, avg_duration_min: int | None, weeks: list[GymWeekOut])`.
  2. Servizio `gym_stats.py`, ogni funzione apre con `ensure_permission(user, Permission.workouts)`:
     - `local_day(column)`: espressione `sa.func.date(sa.func.timezone(settings.app_timezone, column))`;
     - `count_finished(db, user) -> GymCountOut`: `count(*)` su `Workout` con `user_id` e `status == finished`;
     - `period_stats(db, user, start, end) -> GymStatsOut`: `check_period`; una query sugli allenamenti finiti con `local_day(started_at)` nel periodo (id, giorno, durata in secondi); una query aggregata `sum(weight_kg * reps)` su `WorkoutSet` → `WorkoutExercise` → `Workout` degli stessi allenamenti, con `completed_at IS NOT NULL` e peso e reps non null; durata media in minuti interi con `round`; settimane con `weekly_frequency`.
  3. In `routers/stats.py` aggiungere `GET /stats/gym/count` e `GET /stats/gym` (`start`, `end`). `POST /activity` e `GET /stats/streak` restano identici.
  4. In `tests/factories.py` aggiungere `make_finished_workout(db, user, *, started_at, minutes, items: list[tuple[Exercise, list[tuple[weight, reps, duration]]]], status=finished)`, che inserisce `Workout`, `WorkoutExercise` e `WorkoutSet` con `completed_at` valorizzato (per `in_progress` lascia `finished_at` nullo). Serve anche a T6 e T7.
  5. `test_gym_stats.py` (DB, remoto):
     - C9: due allenamenti finiti nel periodo (60 e 90 minuti; serie 100 kg × 5 e 80 kg × 8, una serie `reps` senza peso, una a durata), uno in corso e uno di bob → 2 allenamenti, volume 1140.0, durata media 75, una voce per ogni settimana ISO del periodo con gli zeri; stessi numeri da `GET /api/stats/gym`;
     - un allenamento iniziato alle 23:30 UTC del 30 settembre conta nel giorno 1 ottobre (Europe/Rome);
     - `count` conta solo i finiti dell'utente;
     - periodo non valido → 400; utente senza `workouts.use` → 403; senza login → 401.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -c "import app.main"`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_gym_stats.py --collect-only -q`: raccoglie i test.

  Esecuzione reale in T17.

### [ ] T6. Esercizi eseguiti, progressione e record personali

- Copre: C10, C27, C26 (progressione), R11, R12, R14
- File: `api/app/schemas/stats.py` (modifica), `api/app/services/gym_stats.py` (modifica), `api/app/routers/stats.py` (modifica), `api/tests/test_gym_stats.py` (modifica)
- Passi:
  1. Schemi: `PerformedExerciseOut(exercise_id, name, tracking, custom, last_date)`; `ProgressSessionOut(date, workout_id, metrics: dict[str, float | int], sets: list[str])`; `RecordOut(kind, value: float | int, date)`; `ExerciseProgressOut(exercise_id, name, tracking, start, end, sessions, records)`.
  2. In `gym_stats.py`:
     - `performed_exercises(db, user) -> list[PerformedExerciseOut]`: esercizi presenti in almeno un allenamento finito dell'utente, raggruppati per `exercise_id` con `max(started_at)`, ordinati dal più recente. Join su `Exercise` senza filtrare `archived_at`;
     - `exercise_progress(db, user, exercise_id, start, end) -> ExerciseProgressOut`: `check_period`; esercizio letto con `get_visible_exercises` di `app/services/exercises.py` (che controlla anche il permesso) → `NotFound("exercise not found")` se assente o custom di un altro utente; una query su tutte le serie completate di quell'esercizio negli allenamenti finiti dell'utente (giorno locale, `workout_id`, posizione, peso, reps, durata), raggruppate per allenamento (più occorrenze nello stesso allenamento si sommano); `session_metrics` per le sessioni del periodo, dalla più recente; `personal_records` su tutte le sessioni; `sets` formattate con `format_set` di `gym_rules.py` (stesso testo dello Storico).
  3. In `routers/stats.py`: `GET /stats/gym/exercises` e `GET /stats/gym/exercises/{exercise_id}` (`start`, `end`).
  4. In `test_gym_stats.py` (DB, remoto):
     - C10: esercizio `weight_reps` con sessioni 100 × 5 e 105 × 1 → per sessione `max_weight_kg`, `max_1rm_kg` (116.7 e 105.0), `volume_kg`; record 105, 116.7, 5 reps con le date giuste; esercizio `reps` → `max_reps` e `total_reps`; esercizio `duration` → `max_duration_s` e `total_duration_s`;
     - C27: esercizio custom dell'utente con `archived_at` valorizzato, usato in un allenamento passato → presente in `exercises` e leggibile in `progress`;
     - custom di bob → 404; utente senza `workouts.use` → 403;
     - `exercises` contiene solo esercizi di allenamenti finiti dell'utente (non quelli dell'allenamento in corso né di bob), dal più recente.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -c "import app.main"`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_stats_rules.py -q`: verde;
  - `.venv/Scripts/python -m pytest tests/test_gym_stats.py --collect-only -q`: raccoglie i test.

  Esecuzione reale in T17.

### [ ] T7. Tool MCP di sola lettura e documentazione API

- Copre: C13, C14, C25, C26 (MCP), R17–R20
- File: `api/app/mcp/tools/stats.py` (nuovo), `api/app/mcp/server.py` (modifica), `api/tests/test_mcp_tools_stats.py` (nuovo), `README.md` (modifica)
- Passi:
  1. In `mcp/tools/stats.py` definire `register_stats_tools(server)` con tre tool, ognuno dentro `async with tool_scope() as scope:` e senza `scope.audit` (sola lettura):
     - `get_weight_history(start: date | None = None, end: date | None = None)`: default `end = today()` di `app/mcp/context.py`, `start = end − 29 giorni`; restituisce `weights.weight_history(...)` come dict (`model_dump(mode="json")`);
     - `get_gym_stats(start?, end?)`: stessi default, `gym_stats.period_stats`;
     - `get_exercise_progress(exercise_id: int, start?, end?)`: default `start = end − 89 giorni`, `gym_stats.exercise_progress`.

     Le descrizioni (in inglese) dicono cosa contiene ogni campo (media mobile 7 giorni, medie per settimana ISO, 1RM Epley, record di sempre) e il limite di 366 giorni. Nessun tool di scrittura per pesate o allenamenti.
  2. In `server.py` registrare `register_stats_tools(server)` e aggiungere a `INSTRUCTIONS` una riga: "Stats: get_weight_history (daily weight, 7-day moving average, ISO-week averages), get_gym_stats and get_exercise_progress (sessions, estimated 1RM, personal records) return values already computed by the app."
  3. `test_mcp_tools_stats.py` (DB, remoto) con `mcp_client`, `call`, `call_error` di `tests/mcp_helpers.py` e `make_finished_workout`:
     - C13: `get_weight_history` e `get_gym_stats` con lo stesso periodo restituiscono gli stessi valori di `GET /api/weights` e `GET /api/stats/gym` (confronto dei JSON); senza argomenti usano 30 giorni fino a oggi; un periodo di 367 giorni dà errore; `get_gym_stats` per un utente con solo `mcp.access` dà un errore che contiene `workouts.use`; `get_weight_history` per lo stesso utente funziona;
     - C14: `get_exercise_progress` restituisce sessioni e record come C10 (default 90 giorni); per il custom di bob errore "not found" senza dati;
     - C14: `await client.list_tools()` non contiene nomi che iniziano con `log_`, `delete_` o contengono `weight` diversi da `get_weight_history`;
     - C26: con alice e bob, nessun output dei tool di alice contiene valori di bob.
  4. `README.md`: nella sezione MCP aggiungere i tre tool; nella tabella "API" aggiungere gli endpoint di peso e statistiche palestra; nella sezione deploy una nota sulla nuova migrazione.
- Verifica, da `api/`:
  - `.venv/Scripts/python -m ruff check app tests`: nessun errore;
  - `.venv/Scripts/python -c "from app.mcp.server import mcp_server, INSTRUCTIONS; assert 'get_exercise_progress' in INSTRUCTIONS"`: nessun errore;
  - `.venv/Scripts/python -m pytest tests/test_mcp_tools_stats.py --collect-only -q`: raccoglie i test.

  Esecuzione reale in T17 (insieme ai test MCP esistenti, C25).

### [ ] T8. Client web: hook del peso e delle statistiche palestra

- Copre: C2 (richiesta senza data, invalidazione), base per C6–C8, C11, C12
- File: `web/src/api/weights.ts` (nuovo), `web/src/api/weights.test.tsx` (nuovo), `web/src/api/gym.ts` (modifica)
- Passi:
  1. `weights.ts`, con `client` di `web/src/api/client.ts`: tipi `Weight`, `WeightDay`, `WeightWeek`, `WeightHistory`; `weightKeys = { all: ["weight"], today: ["weight", "today"], range: (start, end) => ["weight", "range", start, end] }`; `useTodayWeight(enabled)` (204 → `null`, come `useActiveWorkout`), `useWeightHistory(start, end, enabled)`, `useSaveWeight()` (`PUT /weights/today` con body `{ weight_kg }` e nient'altro; `onSuccess` invalida `["weight"]`), `useDeleteWeight()` (`DELETE /weights/{id}`, invalida `["weight"]`).
  2. In `gym.ts`: tipi `GymCount`, `GymStats`, `GymWeek`, `PerformedExercise`, `ExerciseProgress`, `ProgressSession`, `PersonalRecord`; chiavi `gymKeys.statsCount`, `gymKeys.stats(start, end)`, `gymKeys.statsExercises`, `gymKeys.progress(id, start, end)`, tutte sotto `["gym", "stats", ...]`; hook `useGymCount`, `useGymStats(start, end, enabled)`, `usePerformedExercises`, `useExerciseProgress(id, start, end, enabled)`. In `useDeleteWorkout` e nella mutation di fine allenamento (quella che oggi invalida `gymKeys.history`) aggiungere `invalidateQueries({ queryKey: ["gym", "stats"] })`, senza cambiare il resto.
  3. `weights.test.tsx`: `fetch` stubbato con `vi.stubGlobal`, `renderHook` dentro `QueryClientProvider`. Casi: `useSaveWeight().mutateAsync(78.4)` fa `PUT /api/weights/today` con body esattamente `{"weight_kg":78.4}` e header `X-Requested-With: yfp`; dopo il successo `invalidateQueries` è chiamata con `["weight"]` (spy sul `QueryClient`); `useTodayWeight` con risposta 204 restituisce `null`.
- Verifica: `cd web && npx vitest run src/api/weights.test.tsx`, verde; `cd web && npx tsc -b`, nessun errore; `cd web && npm test`, suite verde.

### [ ] T9. Grafiche placeholder del peso nella pipeline

- Copre: C31 (placeholder e build), C30 (percorsi distinti), R21
- File: `web/scripts/make-weight-placeholders.py` (nuovo), `web/art/dieta/weight-icon.png` (nuovo, generato), `web/art/palestra/weight-icon.png` (nuovo, generato), `web/art/dieta/weight.png` (nuovo, generato), `web/art/palestra/weight.png` (nuovo, generato), `web/scripts/build-art.py` (modifica), `web/public/art/diet/icons/weight.png`, `web/public/art/gym/icons/weight.png`, `web/public/art/diet/weight.webp`, `web/public/art/gym/weight.webp` (nuovi, generati), `web/src/lib/art.ts` (modifica), `web/src/lib/art.test.ts` (nuovo)
- Passi:
  1. `make-weight-placeholders.py` (Pillow, deterministico) scrive le quattro sorgenti nei formati delle sorgenti reali:
     - icona: PNG RGBA 1024×1024 a sfondo trasparente con una bilancia pesapersone stilizzata (piatto arrotondato, quadrante, contorno marrone scuro), disegnata su una griglia 32×32 e ingrandita con `NEAREST` per l'effetto pixel; tinta salvia per la Dieta, corallo per la Palestra, prese con un campionamento dei colori da `web/art/{dieta,palestra}/icons.png`;
     - sfondo: PNG RGB 941×1672 (come `settings.png`), fondo crema campionato da `settings.png`, una bilancia grande nel terzo inferiore e la parte alta libera, stessa tecnica pixel;
     - in testa un commento: "Placeholder: da sostituire con gli asset di art-prompts.md, stessi nomi file".
  2. In `build-art.py`:
     - aggiungere `"weight"` alla tupla dei nomi in `save_backgrounds` → `public/art/{diet,gym}/weight.webp` (stessa larghezza 941, WEBP qualità 80);
     - aggiungere `save_weight_icon(mode)`, che legge `art/<mode>/weight-icon.png`, usa `trimmed_cutout`, lo centra su una tela quadrata con lo stesso margine del 6% di `save_icon_sheet` e salva `public/art/<mode>/icons/weight.png` 96×96; se la sorgente manca solleva un errore chiaro. Chiamarla in `main()`.
  3. Eseguire `python web/scripts/make-weight-placeholders.py` e poi `python web/scripts/build-art.py`. Controllare con `git status` che cambino solo i file nuovi del peso; se lo script riscrive con byte diversi asset esistenti (icone, badge, PWA), ripristinarli con `git checkout -- <file>` e annotarlo nel registro.
  4. In `art.ts` aggiungere `"weight"` alle union `DietIcon` e `GymIcon` e la funzione `weightScene(mode)` → `/art/${mode}/weight.webp`, con un docstring come `settingsScene`.
  5. `art.test.ts`: `artIcon("diet", "weight")` → `/art/diet/icons/weight.png`, `artIcon("gym", "weight")` → `/art/gym/icons/weight.png`, `weightScene("diet")` e `weightScene("gym")` diversi; i quattro file esistono sotto `web/public` (`fs.existsSync`, come `pushSw.test.ts` legge `public/`).
- Verifica:
  - `python web/scripts/build-art.py`: termina senza errori e il report elenca `public/art/diet/weight.webp`, `public/art/gym/weight.webp`, `public/art/diet/icons/weight.png`, `public/art/gym/icons/weight.png`;
  - `cd web && npx vitest run src/lib/art.test.ts`: verde;
  - `cd web && npm test`: suite verde.

### [ ] T10. Tasto peso nell'header e overlay di inserimento

- Copre: C1, C2, C20, C24, C30 (parte automatica), R1–R3
- File: `web/src/components/WeightButton.tsx` (nuovo), `web/src/components/WeightOverlay.tsx` (nuovo), `web/src/components/WeightOverlay.test.tsx` (nuovo), `web/src/components/ModeSwitch.tsx` (modifica), `web/src/components/ModeSwitch.test.tsx` (modifica)
- Passi:
  1. `WeightButton`: renderizza `null` se `modeFromPath(pathname) === null` (quindi niente su `/settings`, `/account`, `/admin/*`); altrimenti un `button` `absolute left-2 top-1/2 h-11 w-11 -translate-y-1/2` (specchio di `SettingsButton`) con `aria-label="Registra peso"` e `<img src={artIcon(mode, "weight")} className="h-7 w-7">`. Lo stato `open` monta `WeightOverlay` solo quando è vero.
  2. `WeightOverlay({ mode, onClose })`: contenitore `fixed inset-0 z-50` con due livelli come `SettingsBackdrop` (pattern della sezione e `weightScene(mode)` con la classe `settings-scene`, `data-testid="weight-scene"`), e sopra, nella parte alta dello schermo (così la tastiera iOS non lo copre), una card con:
     - `input` con `inputMode="decimal"`, `aria-label="Peso in kg"`, `autoFocus`, precompilato con `formatKg` di `web/src/lib/gym.ts` dal valore di `useTodayWeight(true)` quando arriva (solo se l'utente non ha ancora scritto);
     - pulsante "Salva": `parseDecimal` di `lib/gym.ts`; se `null` o fuori 20–400 mostra "Inserisci un peso tra 20 e 400 kg" (`role="alert"`) senza richieste; altrimenti `useSaveWeight().mutate(value)`; al successo mostra "Peso salvato" per circa 1 s e chiama `onClose`; un errore 400 o di rete mostra il messaggio e l'overlay resta aperto;
     - pulsante "Chiudi" (`aria-label="Chiudi"`) che chiama `onClose` senza richieste; anche `Escape` chiude.
  3. In `ModeSwitch.tsx` renderizzare `<WeightButton />` prima del gruppo, accanto a `SettingsButton`. Il `return null` su `/settings` senza permesso palestra, il `px-14` e il selettore restano invariati. Aggiornare il commento del componente.
  4. `ModeSwitch.test.tsx`: lasciare invariati i quattro casi esistenti e aggiungere (C1):
     - su `/` e su `/gym/history` c'è il pulsante "Registra peso" con icona `/art/diet/icons/weight.png` e `/art/gym/icons/weight.png`, e c'è il link "Impostazioni";
     - su `/settings` con permesso palestra il pulsante peso non c'è;
     - senza `workouts.use` su `/` il pulsante peso c'è e il gruppo "Sezione" no.
  5. `WeightOverlay.test.tsx`, con `../api/weights` mockato:
     - C2: scrivere "78,4" e premere "Salva" → `mutate` chiamato con `78.4`; simulando il successo l'overlay chiama `onClose`;
     - C2: con `useTodayWeight` che restituisce `{ weight_kg: 78.4 }` il campo vale "78,4";
     - C2: "abc" e "15" → messaggio di errore, `mutate` mai chiamato, `onClose` mai chiamato;
     - un errore della mutation → messaggio, overlay aperto;
     - "Chiudi" → `onClose` senza `mutate`;
     - C30 (parte automatica): con `mode="diet"` lo sfondo usa `/art/diet/weight.webp`, con `mode="gym"` `/art/gym/weight.webp`; il campo ha `inputmode="decimal"`.
- Verifica:
  - `cd web && npx vitest run src/components/ModeSwitch.test.tsx src/components/WeightOverlay.test.tsx src/components/AppShell.test.tsx src/lib/appMode.test.ts src/pages/DayPage.test.tsx src/pages/WeekPage.test.tsx src/pages/SettingsPage.test.tsx`: verdi (C20, header delle pagine esistenti);
  - `cd web && npx vitest run src/lib/useVisualViewportTop.test.ts src/pages/gym/WorkoutPage.test.tsx`: verdi (C24, la sessione live non usa `ModeSwitch`);
  - `cd web && npx tsc -b` e `cd web && npm test`: nessun errore, suite verde.

### [ ] T11. Card "N allenamenti" e badge palestra ogni 10 allenamenti

- Copre: C7, C17
- File: `web/src/lib/badges.ts` (modifica), `web/src/lib/badges.test.ts` (modifica), `web/src/components/BadgeGrid.tsx` (modifica), `web/src/components/BadgeGrid.test.tsx` (modifica), `web/src/components/WorkoutCountCard.tsx` (nuovo), `web/src/components/WorkoutCountCard.test.tsx` (nuovo), `web/src/pages/gym/GymStatsPage.tsx` (modifica)
- Passi:
  1. In `badges.ts`: aggiungere `WORKOUTS_PER_BADGE = 10` e il secondo parametro `badgeProgress(value, perBadge = DAYS_PER_BADGE)`, con `nextIn` = unità mancanti. Aggiungere `gymBadgeProgress(workouts) = badgeProgress(workouts, WORKOUTS_PER_BADGE)`. Il comportamento con un solo argomento non cambia.
  2. In `BadgeGrid.tsx` aggiungere la prop opzionale `unit: "streak" | "workouts"` (default `"streak"`). Con `"workouts"`: "Prossimo badge tra K allenamenti" (singolare "1 allenamento"), "Primo badge a 10 allenamenti", etichetta dei badge bloccati `n × 10` (es. "20 all."); con `"streak"` testi identici a oggi. Immagini `badgeIcon(mode, n)` invariate.
  3. `WorkoutCountCard`: usa `useGymCount()`; mostra "N allenamenti" (singolare "1 allenamento"), un'icona della sezione (`artIcon("gym", "medal")`) e `<BadgeGrid mode="gym" current={finished} unit="workouts" />`; stati di caricamento ed errore nel blocco ("Impossibile caricare gli allenamenti.").
  4. `GymStatsPage.tsx`: sostituire `StreakCard` e il testo "Statistiche palestra in arrivo." con `WorkoutCountCard`. Aggiornare il commento del componente. `StreakCard.tsx` non cambia (resta usato dalla Dieta).
  5. Test:
     - `badges.test.ts`: lasciare invariati i casi esistenti e aggiungere `gymBadgeProgress` per 0, 9, 10, 299, 300, 350 (C7);
     - `BadgeGrid.test.tsx`: lasciare invariati i casi esistenti e aggiungere un caso `unit="workouts"` con `current={3}` → "Primo badge a 10 allenamenti";
     - `WorkoutCountCard.test.tsx` con `useGymCount` mockato: 23 → "23 allenamenti", "Badge 2 / 30", "Prossimo badge tra 7 allenamenti" e nessun testo "di fila"; 1 → "1 allenamento"; 0 → "Primo badge a 10 allenamenti"; 300 e 350 → "Collezione completa!"; errore → messaggio.
- Verifica: `cd web && npx vitest run src/lib/badges.test.ts src/components/BadgeGrid.test.tsx src/components/StreakCard.test.tsx src/components/WorkoutCountCard.test.tsx`, tutti verdi con i casi esistenti invariati (C17); `cd web && npm test`, suite verde.

### [ ] T12. Statistiche Palestra: periodo, riepilogo e frequenza settimanale

- Copre: C8, C19, R9, R10, R13 (errore per blocco)
- File: `web/src/lib/usePeriodParams.ts` (nuovo), `web/src/pages/DietStatsPage.tsx` (modifica), `web/src/components/stats/GymSummaryCard.tsx` (nuovo), `web/src/components/stats/WeeklyFrequencyChart.tsx` (nuovo), `web/src/components/stats/charts.test.tsx` (modifica), `web/src/pages/gym/GymStatsPage.tsx` (modifica), `web/src/pages/gym/GymStatsPage.test.tsx` (nuovo)
- Passi:
  1. Spostare `readChoice` e i tre setter di `DietStatsPage.tsx` in `usePeriodParams()`, che restituisce `{ choice, today, error, period, setPreset, openCustom, setDates }`. I setter aggiornano `range` oppure `from`/`to` togliendo l'altra forma e preservando gli altri parametri (es. `exercise`), con `{ replace: true }`. `DietStatsPage` usa l'hook senza altre modifiche visibili.
  2. `GymSummaryCard({ stats })`: tre valori, "Allenamenti", "Volume" (kg con separatore delle migliaia `toLocaleString("it-IT")`), "Durata media" (minuti o "—"); con 0 allenamenti mostra i valori a zero e "Nessun allenamento nel periodo".
  3. `WeeklyFrequencyChart({ weeks })`: SVG come `KcalChart`, una `rect` per settimana (`data-testid="frequency-bar"`, anche a zero con altezza minima o assente ma con etichetta), etichette con `formatIsoDateShort` e `labelStep`, titolo "Frequenza settimanale".
  4. `GymStatsPage`: sotto `WorkoutCountCard`, `PeriodPicker` alimentato da `usePeriodParams`, poi `useGymStats(period.start, period.end, error === null)` → caricamento, errore nel blocco ("Impossibile caricare le statistiche."), oppure `GymSummaryCard` e `WeeklyFrequencyChart`. Un errore qui non nasconde gli altri blocchi.
  5. Test:
     - `charts.test.tsx`: aggiungere casi per `WeeklyFrequencyChart` (una barra per settimana) e `GymSummaryCard` (valori e stato vuoto), senza toccare i casi esistenti;
     - `GymStatsPage.test.tsx` (hook di `../../api/gym` mockati, `todayIso` fissato come in `DietStatsPage.test.tsx`, `ModeSwitch` e `WorkoutCountCard` sostituiti da segnaposto): default 7 giorni → `useGymStats` chiamato con `("2026-09-19", "2026-09-25", true)`; click su "30 giorni" → nuovo periodo e query string `range=30`; `?from=2026-09-01&to=2026-09-10` → richiesta con quelle date; intervallo invertito → messaggio di errore e `enabled` falso; dati finti → numero, volume, durata media e una barra per settimana; zero allenamenti → "Nessun allenamento nel periodo"; `isError` → messaggio nel blocco e `WorkoutCountCard` ancora presente.
- Verifica: `cd web && npx vitest run src/pages/gym/GymStatsPage.test.tsx src/pages/DietStatsPage.test.tsx src/components/stats/charts.test.tsx src/lib/stats.test.ts src/components/GoalForm.test.tsx`, tutti verdi con i test Dieta invariati (C19); `cd web && npm test`, suite verde.

### [ ] T13. Statistiche Palestra: progressione dell'esercizio e record

- Copre: C11, R11, R12, R13 (stati vuoti ed errori dei blocchi)
- File: `web/src/components/stats/ExerciseProgressSection.tsx` (nuovo), `web/src/components/stats/ProgressChart.tsx` (nuovo), `web/src/components/stats/PersonalRecords.tsx` (nuovo), `web/src/components/stats/charts.test.tsx` (modifica), `web/src/pages/gym/GymStatsPage.tsx` (modifica), `web/src/pages/gym/GymStatsPage.test.tsx` (modifica)
- Passi:
  1. `ExerciseProgressSection({ period, enabled })`:
     - `usePerformedExercises()`; lista vuota → "Completa un allenamento per vedere i progressi" e nient'altro del blocco;
     - un `select` con `aria-label="Esercizio"` con gli esercizi nell'ordine ricevuto (dal più recente); valore da `?exercise=` se presente nella lista, altrimenti il primo; il cambio scrive `exercise` nel query string preservando il periodo;
     - `useExerciseProgress(id, period.start, period.end, enabled)`; errore → messaggio nel blocco;
     - selettore della metrica (pulsanti `aria-pressed`) con le chiavi del tracking: `weight_reps` → "Carico max", "1RM stimato", "Volume"; `reps` → "Reps max", "Reps totali" (+ "Carico max", "Volume" se presenti nelle sessioni); `duration` → "Durata max", "Durata totale";
     - `ProgressChart` per la metrica scelta e, sotto, lo storico per sessione (data con `formatIsoDateLong` e le serie già formattate dal server, dalla più recente); senza sessioni nel periodo "Nessuna sessione nel periodo";
     - `PersonalRecords` con le etichette dei record e la data.
  2. `ProgressChart({ points })`: SVG linea + punti (`data-testid="progress-point"`), stesso stile dei grafici esistenti.
  3. In `GymStatsPage` aggiungere la sezione sotto frequenza, con lo stesso periodo.
  4. Test:
     - `charts.test.tsx`: un punto per sessione in `ProgressChart`;
     - `GymStatsPage.test.tsx`: con due esercizi finti la `select` ha il più recente scelto; scegliendo il secondo il query string contiene `exercise=<id>` e `useExerciseProgress` è chiamato con quell'id; con un esercizio `weight_reps` compaiono i pulsanti "Carico max", "1RM stimato", "Volume", le serie della sessione ("100 kg × 5") e i record con la data; con un esercizio `duration` compaiono "Durata max" e "Durata totale"; senza esercizi eseguiti compare "Completa un allenamento per vedere i progressi"; errore della progressione → messaggio e il riepilogo resta.
- Verifica: `cd web && npx vitest run src/pages/gym/GymStatsPage.test.tsx src/components/stats/charts.test.tsx`, verdi; `cd web && npx tsc -b` e `cd web && npm test`, nessun errore, suite verde.

### [ ] T14. Blocco Peso in Statistiche Dieta

- Copre: C6, C19, R4, R5
- File: `web/src/components/stats/WeightChart.tsx` (nuovo), `web/src/components/stats/WeightSection.tsx` (nuovo), `web/src/components/stats/charts.test.tsx` (modifica), `web/src/pages/DietStatsPage.tsx` (modifica), `web/src/pages/DietStatsPage.test.tsx` (modifica)
- Passi:
  1. `WeightChart({ days })`: SVG con un punto per ogni giorno con pesata (`data-testid="weight-point"`) e una `polyline` della media mobile (`data-testid="weight-avg-line"`) sui giorni con `avg_7d_kg` non nullo; scala verticale tra minimo e massimo dei valori con un margine; etichette con `labelStep`.
  2. `WeightSection({ period, enabled })`: `useWeightHistory(period.start, period.end, enabled)`; errore → messaggio nel blocco; senza pesate nel periodo "Nessuna pesata nel periodo"; altrimenti titolo "Peso", `WeightChart` e la lista delle pesate (giorni con `weight_kg` non nullo, dalla più recente) con data (`formatIsoDateLong`), kg (`formatKg`) e un pulsante "Elimina" (`aria-label="Elimina pesata del <data>"`) che chiede `window.confirm("Eliminare questa pesata?")` e chiama `useDeleteWeight().mutate(id)`; nessun comando di modifica.
  3. In `DietStatsPage.tsx` aggiungere `<WeightSection period={period} enabled={error === null} />` sotto `SummaryTable`, fuori dal ramo di caricamento del diario, così un errore del diario non nasconde il peso e viceversa. Il resto della pagina non cambia.
  4. Test:
     - `charts.test.tsx`: `WeightChart` con tre pesate e medie → tre punti e la linea della media;
     - `DietStatsPage.test.tsx`: mockare `../api/weights` nel modulo; i casi esistenti restano invariati (con `useWeightHistory` che restituisce un periodo vuoto per default). Nuovi casi: con pesate finte compaiono grafico, linea della media e storico dalla più recente; "Elimina" con `confirm` vero → `mutate` con l'id di quella pesata; con `confirm` falso nessuna chiamata; senza pesate "Nessuna pesata nel periodo"; `useWeightHistory` chiamato con lo stesso periodo di `useDiaryRange`.
- Verifica: `cd web && npx vitest run src/pages/DietStatsPage.test.tsx src/components/stats/charts.test.tsx src/components/GoalForm.test.tsx src/lib/stats.test.ts`, verdi (C19); `cd web && npm test`, suite verde.

### [ ] T15. Swipe per eliminare nello Storico

- Copre: C12, C21, C22, R15, R16
- File: `web/src/components/gym/SwipeableCard.tsx` (nuovo), `web/src/pages/gym/HistoryPage.tsx` (modifica), `web/src/pages/gym/HistoryPage.test.tsx` (modifica)
- Passi:
  1. `SwipeableCard({ open, onOpenChange, onDelete, children })`:
     - contenitore `relative overflow-hidden` con, sotto, un pulsante "Elimina" largo 88 px allineato a destra (rosso, visibile solo quando la card è spostata) e, sopra, il contenuto traslato con `transform: translateX(...)`, `touch-action: pan-y`;
     - `touchstart`: ignora i tocchi che partono entro 24 px dal bordo sinistro dello schermo (gesto "indietro" di iOS); registra il punto iniziale;
     - `touchmove`: entro 10 px nessuna decisione; poi blocca la direzione: orizzontale solo se `|dx| > 1.5 × |dy|`, altrimenti il gesto è verticale e la card non si muove fino al `touchend`; in orizzontale segue il dito tra −88 e 0;
     - `touchend`: apre se lo spostamento supera −44 px, altrimenti chiude; uno swipe verso destra su una card aperta la chiude;
     - `onClickCapture`: se la card è aperta o c'è appena stato un trascinamento, `preventDefault` + `stopPropagation` e chiude, così il tap non apre il dettaglio.
  2. In `HistoryPage.tsx`: stato `openId` (una sola card aperta); ogni `Link` attuale va dentro `SwipeableCard`; un `touchstart`/`pointerdown` su `document` fuori dalla card aperta la chiude. "Elimina" → `window.confirm("Eliminare questo allenamento dallo storico?")`; se confermato `useDeleteWorkout().mutate(id, { onSuccess: chiudi, onError: messaggio })`; se annullato la card si richiude. L'errore mostra "Impossibile eliminare l'allenamento." (`role="alert"`) e la card resta. Raggruppamento per mese, "Carica altri" e markup interno della card non cambiano.
  3. `HistoryPage.test.tsx`: i casi di T1 restano invariati (aggiungere solo il mock di `useDeleteWorkout`). Nuovi casi con `fireEvent.touchStart/touchMove/touchEnd`:
     - trascinamento orizzontale di −100 px su una card → compare "Elimina"; click con `confirm` vero → `mutate` con l'id di quella card; simulando `onSuccess` la card è chiusa;
     - con `confirm` falso → nessuna `mutate` e la card è chiusa;
     - `onError` → messaggio di errore e la card c'è ancora;
     - trascinamento prevalentemente verticale (dx −30, dy 120) → nessun "Elimina" visibile;
     - aprire la seconda card richiude la prima;
     - un tap su una card aperta la richiude senza navigare (la route di destinazione non compare);
     - un trascinamento che parte a `clientX` 10 non apre la card.
- Verifica: `cd web && npx vitest run src/pages/gym/HistoryPage.test.tsx src/pages/gym/WorkoutDetailPage.test.tsx`, verdi (C21, C22); `cd web && npx tsc -b` e `cd web && npm test`, nessun errore, suite verde.

### [ ] T16. Prompt delle grafiche definitive

- Copre: C31 (documento), R22
- File: `docs/features/2026-10-02-statistiche-palestra-peso/art-prompts.md` (nuovo)
- Passi:
  1. Scrivere una sezione introduttiva sullo stile, ricavata da `web/art/{dieta,palestra}/settings.png` e `icons.png`: pixel art morbida con pixel visibili e contorno marrone scuro, illuminazione calda e piatta, gatto soriano arancione paffuto con occhi verdi (Dieta: cappello e grembiule da cuoco, cucina con mensole, piante, quadretti salvia; Palestra: fascia rossa, canotta salvia, pantaloncini corallo, tappetino, manubri, piante), fondo crema con la parte alta libera e soggetti nel terzo inferiore. Palette in esadecimale campionata con Pillow dai file sorgente (crema, salvia, corallo, marrone del contorno, arancio del gatto).
  2. Quattro prompt in inglese, ognuno in un blocco pronto da incollare, con: soggetto a tema peso (Dieta: il gatto cuoco su una bilancia pesapersone in cucina; Palestra: il gatto sportivo su una bilancia in palestra; icone: una bilancia pesapersone sola, nello stile delle icone), dimensioni e proporzioni, sfondo (trasparente per le icone), cosa evitare (testo, numeri leggibili sul quadrante, bordi sfumati nelle icone), e il nome del file atteso:
     - `web/art/dieta/weight-icon.png` e `web/art/palestra/weight-icon.png`: generazione 1024×1024 con sfondo trasparente, soggetto centrato con margine;
     - `web/art/dieta/weight.png` e `web/art/palestra/weight.png`: generazione verticale 1024×1536 (formato verticale disponibile nel generatore); indicare che l'inquadratura finale è quella di `settings.png` (941×1672, portrait ancorato in basso, in landscape colonna centrata con bordi sfumati), quindi i soggetti stanno nella fascia centrale e nel terzo inferiore e niente di importante sui bordi laterali.
  3. Sezione "Integrazione": copiare i file ricevuti nello zip con quei nomi in `web/art/{dieta,palestra}/`, eseguire `python web/scripts/build-art.py`, controllare con `git status` che cambino solo `web/public/art/{diet,gym}/weight.webp` e `web/public/art/{diet,gym}/icons/weight.png`, poi `cd web && npm test` e commit. Nessuna modifica al codice.
- Verifica: `grep -c "^### " docs/features/2026-10-02-statistiche-palestra-peso/art-prompts.md` restituisce almeno 4 sezioni di prompt e `grep -c "weight-icon.png\|weight.png" docs/features/2026-10-02-statistiche-palestra-peso/art-prompts.md` trova i quattro nomi file; `cd web && npm test`, suite verde.

### [ ] T17. Deploy remoto: migrazione e suite pytest completa

- Copre: C3, C4, C5, C9, C10, C13, C14, C18, C23, C25, C26, C29 (esecuzione reale sul DB)
- File: Nessuno (a parte eventuali correzioni a test o codice API emerse dall'esecuzione, da riportare nel registro)
- Passi:
  1. `cd web && npm test` e `cd web && npm run build` in locale: suite verde e build senza errori (C28).
  2. Push di `feature/statistiche-palestra-peso` su `origin`.
  3. Sul server: `git pull` del branch, `docker compose up -d --build`, `docker compose exec api alembic upgrade head` su un DB con dati esistenti; poi `docker compose exec api alembic downgrade -1` e di nuovo `upgrade head` per verificare il downgrade (C29).
  4. Sul server eseguire la suite pytest completa dell'API con il comando abituale per i test DB, e in particolare `pytest tests/test_weight_models.py tests/test_weights.py tests/test_gym_stats.py tests/test_mcp_tools_stats.py tests/test_activity_router.py tests/test_streak.py tests/test_gym_routers.py tests/test_workouts_finish.py tests/test_mcp_tools_diary.py tests/test_mcp_tools_foods.py tests/test_mcp_tools_workouts.py tests/test_permissions_mcp.py -v`.
  5. Da browser loggato: `GET /api/stats/gym/count` e `GET /api/weights?start=...&end=...` rispondono 200.
- Verifica, sul server: `alembic current` mostra `a6c1e4b8d203 (head)`; il ciclo downgrade/upgrade termina senza errori; pytest: tutti i test passano, vecchi e nuovi.

### [ ] T18. Verifica manuale su iPhone (checklist)

- Copre: C15, C16, C30, C31 (a vista), più conferme a vista per C1 (schermi stretti) e C21
- File: Nessuno
- Passi. Su iPhone con la PWA installata e aggiornata (chiuderla dallo switcher e riaprirla):
  1. C30: dal Giorno toccare il tasto peso: overlay con lo sfondo peso della Dieta e l'icona peso della Dieta sul tasto; chiudere con "Chiudi": nessuna pesata salvata. Ripetere dallo Storico palestra: sfondo e icona della Palestra.
  2. C15: aprendo il campo compare la tastiera decimale di iOS, la virgola funziona ("78,4"), il campo e il pulsante "Salva" restano visibili sopra la tastiera; dopo il salvataggio compare la conferma e in Statistiche Dieta la pesata è nel grafico e nello storico.
  3. C1 a vista: su iPhone stretto il tasto peso, il selettore Dieta|Palestra e l'ingranaggio non si sovrappongono.
  4. C16: nello Storico lo scroll verticale non apre card; uno swipe a sinistra su una card rivela "Elimina"; lo swipe dal bordo sinistro torna indietro come prima; tap su una card chiusa apre il dettaglio (C21).
  5. C31 a vista: le quattro grafiche placeholder si vedono nei punti giusti senza errori 404 (Safari Web Inspector o nessuna immagine rotta).
  6. Statistiche Palestra: card "N allenamenti" con badge, periodo, riepilogo, frequenza, progressione e record di un esercizio reale.
- Verifica: manuale. Risultato atteso: tutti i punti confermati dall'utente e annotati nel registro.

## Domande aperte

Risolte il 2026-10-02:

1. Parametri del periodo: `start`/`end` in REST e MCP (spec R17–R19 aggiornata).
2. Tasto peso su `/search`: no, solo nelle pagine con `ModeSwitch` (spec R1 aggiornata).
3. Sfondi generati: nessun ritaglio in `build-art.py`; il formato è documentato in `art-prompts.md`.

## Registro di esecuzione

- Commit di partenza: 5690b5d
- T1 — DONE — review: 1 round — commit: 4ddd7b9 — MINOR: test usa monthLabel di produzione; onSuccess invocato a mano dal mock
- T2 — DONE — review: 1 round — commit: d302445 — MINOR aperti: peso 0 conta come zavorra/max in session_metrics e personal_records; test senza dataset C10 esatto, serie a durata a volume 0, parità per reps/durata
- T3 — DONE — review: 1 round — commit: 4fa9e3e
- T4 — DONE — review: 1 round — commit: beb2a53 — MINOR aperto: body senza weight_kg dà 422 invece di 400 (fix: weight_kg: Any = None)
