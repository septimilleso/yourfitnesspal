# Piano: massimo raggiunto sotto il precedente

- Data: 2026-10-07
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: feature
- Branch: feature/massimo-esercizio-allenamento

testCommand: `cd web && npm test` (vitest run, ambiente jsdom).

## Approccio

Prima si fissa con test di caratterizzazione il comportamento attuale che la feature sfiora (T1): il `previous` per posizione con una serie incompleta in mezzo allo storico, la cella "Precedente" di `SetRow` e `setGridColumns`. Poi il backend (T2): un campo opzionale `max_set` su `WorkoutSetOut`, accanto a `previous`, valorizzato in `workout_out()` (`api/app/services/workouts.py`) solo per gli allenamenti `in_progress`, come `previous`. Infine il web (T3, T4): tipo opzionale in `web/src/api/gym.ts` e seconda riga dentro la cella "Precedente" di `web/src/components/gym/SetRow.tsx`.

Calcolo del massimo, una sola query per risposta. Nuova funzione `best_sets(db, user, exercise_ids)` in `workouts.py`, accanto a `previous_sets()`. La query numera con `row_number() OVER (PARTITION BY workout_exercise_id ORDER BY position)` le serie completate (`completed_at IS NOT NULL`) degli allenamenti `finished` dell'utente con `exercise_id IN (...)`, così "N-esima serie completata di ogni comparsa" coincide con la posizione usata da `previous_sets()` (che filtra le completate e le ordina per `position`). Sulla sottoquery un `DISTINCT ON (exercise_id, n)` con `ORDER BY exercise_id, n, coalesce(weight_kg,0) DESC, coalesce(reps,0) DESC, coalesce(duration_s,0) DESC` tiene una sola riga per esercizio e posizione. L'ordine unico copre tutti i tracking: per `weight_reps` e `reps` prima peso (assente = 0) poi rep; per `duration` peso e rep sono assenti, quindi decide la durata. Il risultato è `dict[int, list[SetValues]]` indicizzato per `exercise_id` e posizione 0-based; `_best_at(...)` (gemello di `_previous_at`) restituisce `None` oltre la lunghezza della lista. L'allenamento in corso è escluso perché il filtro è su `status == finished`. Per i finiti (`else` di `workout_out`) il campo resta `None`.

Web: `WorkoutSet.max_set?: SetValues | null` (opzionale, un fixture o una cache senza il campo valgono "nessun massimo"). In `SetRow` la cella "Precedente" resta un solo figlio della griglia: un `div` che contiene il `button` esistente, invariato (stessi classi, `aria-label`, `disabled`, `onClick` che copia solo `set.previous`), e sotto un `span` non interattivo `max <formatSet>` a ~11px, grigio, `truncate`, con `aria-label="Massimo serie N: <formatSet>"`. `setGridColumns` non cambia.

Ambiente: nessun Postgres locale. I test DB (`db` fixture di `api/tests/conftest.py`) si scrivono nei task ma girano solo sul server remoto via docker compose (T5). In locale si verificano `py_compile`, `ruff` e i test puri senza DB, per esempio `api/tests/test_gym_rules.py` (passano: 10 test), lanciati con `api/.venv/Scripts/python.exe -m pytest`.

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [ ] T1. Test di caratterizzazione di precedente, cella e griglia

- Copre: C8, C9 (prepara C1, C6)
- Rischio: basso
- File: `web/src/components/gym/SetRow.test.tsx` (modifica), `web/src/lib/gym.test.ts` (modifica), `api/tests/test_workouts_live.py` (modifica)
- Passi:
  1. In `SetRow.test.tsx` aggiungere: (a) con `previous` 77,5 × 8 la cella mostra "77,5 kg × 8" e nessun testo che inizia con "max"; (b) con `previous: null` il bottone "Usa precedente serie 1" è disabilitato e mostra "—"; (c) la riga della griglia ha lo stesso numero di figli diretti di oggi (serie, precedente, kg, rip., tick = 5) per `weight_reps`. Il test esistente `shows the previous values and copies them on tap` resta intatto.
  2. In `web/src/lib/gym.test.ts` aggiungere un test su `setGridColumns(1)` e `setGridColumns(2)` con la stringa attuale (`2.25rem minmax(0,1.3fr) repeat(N, minmax(0,1fr)) 2.75rem`).
  3. In `api/tests/test_workouts_live.py` aggiungere `test_previous_follows_completed_position_skipping_incomplete`: un allenamento finito per l'utente con tre serie dell'esercizio (80 × 8 completata, 120 × 1 con `completed_at=None`, 100 × 5 completata), costruito con i modelli come in `test_empty_workout_and_previous_values`. Avviato un allenamento e aggiunto l'esercizio con una serie in più (3 serie nel nuovo), `previous` delle serie vale 80 × 8, 100 × 5, `None`. Il test documenta la nozione di posizione che il massimo deve rispettare.
- Verifica: `cd web && npm test`, risultato atteso: tutti i test passano, compresi i nuovi. Backend: `api/.venv/Scripts/python.exe -m py_compile api/tests/test_workouts_live.py` senza errori; il test DB gira solo sul server remoto (T5), non in locale.

### [ ] T2. Backend: `max_set` per posizione in `WorkoutOut`

- Copre: C1, C2, C3, C4, C10
- Rischio: alto
- File: `api/app/schemas/workout.py` (modifica), `api/app/services/workouts.py` (modifica), `api/tests/test_workouts_live.py` (modifica)
- Passi:
  1. In `schemas/workout.py`, `WorkoutSetOut`: aggiungere `max_set: SetValues | None = None` con commento (massimo per posizione tra le serie completate degli allenamenti finiti; `None` per allenamenti finiti o senza storico).
  2. In `workouts.py` scrivere `best_sets(db, user, exercise_ids) -> dict[int, list[SetValues]]` come descritto in Approccio: una sola `db.execute`, `{}` se `exercise_ids` è vuoto, filtri `Workout.user_id == user.id`, `Workout.status == WorkoutStatus.finished`, `WorkoutSet.completed_at.is_not(None)`, `WorkoutExercise.exercise_id.in_(ids)`; `n` da `row_number()` con `partition_by=WorkoutSet.workout_exercise_id, order_by=WorkoutSet.position`. Costruire le liste in ordine di `n` (le posizioni sono contigue per costruzione) e aggiungere `_best_at(best, index)`.
  3. In `workout_out()`: nel ramo `in_progress` chiamare `best_sets(db, user, {item.exercise_id for item in workout.exercises})` e passare `max_set=_best_at(best.get(item.exercise_id), number)` a `WorkoutSetOut`; negli altri casi `best = {}`, quindi `None`. Nessun'altra modifica a `previous_sets`, `add_exercise`, `add_set`.
  4. Test DB in `api/tests/test_workouts_live.py` (con `make_user`, `make_exercise`, `make_finished_workout` di `api/tests/factories.py`, per le serie incomplete creare `Workout`/`WorkoutSet` direttamente): `test_max_set_per_position` (C1: allenamento A 80×8 completata, 120×1 incompleta, 100×5 completata, 70×10 completata; B 90×6, 100×4; allenamento in corso con 4 serie; attesi 90×6, 100×5, 70×10, `None`); `test_max_set_ordering` (C2: in posizione 1 le serie 90×4, 90×5, 80×8 danno 90×5; esercizio `Tracking.weight_reps` con serie 0 kg × 12 e 0 kg × 15 dà 0×15; esercizio `Tracking.duration` con 60 s e 90 s dà 90 s); `test_max_set_ignores_other_users_and_active_workout` (C3: secondo utente con serie più pesanti e serie completate più pesanti nell'allenamento in corso non cambiano i massimi); `test_max_set_none_for_finished_workout` (C10: dopo `finish` o con `get_workout` su un finito, ogni `max_set` è `None`); `test_max_set_single_query` (C4: con un listener `before_cursor_execute` su `engine.sync_engine` contare le istruzioni eseguite da `best_sets` per 1 e per 3 esercizi: sempre 1).
- Verifica: `api/.venv/Scripts/python.exe -m py_compile api/app/services/workouts.py api/app/schemas/workout.py api/tests/test_workouts_live.py` e `api/.venv/Scripts/ruff.exe check api/app api/tests/test_workouts_live.py` senza errori; `api/.venv/Scripts/python.exe -m pytest api/tests/test_gym_rules.py api/tests/test_stats_rules.py -q` verde. Nota: i test `test_max_set_*` richiedono Postgres e girano solo sul server remoto via docker compose (T5); in locale non si dichiara che passano.

### [ ] T3. Web: tipo e seconda riga "max" nella cella "Precedente"

- Copre: C5, C6, C7, C8, C9
- Rischio: alto
- File: `web/src/api/gym.ts` (modifica), `web/src/components/gym/SetRow.tsx` (modifica), `web/src/components/gym/SetRow.test.tsx` (modifica)
- Passi:
  1. In `gym.ts`, `WorkoutSet`: aggiungere `max_set?: SetValues | null` con commento (massimo per posizione di serie; assente o `null` = nessun massimo).
  2. In `SetRow.tsx` racchiudere il bottone "Precedente" in un `div` con `min-w-0` (unico figlio di griglia al posto del bottone), lasciando il `button` identico (classi, `aria-label`, `disabled`, `onClick`, testo). Sotto, se `set.max_set` esiste, un `span` non interattivo con `block truncate text-center text-[11px] leading-tight text-slate-400` e testo `max ${formatSet(tracking, set.max_set)}`, `aria-label={`Massimo serie ${number}: ${formatSet(tracking, set.max_set)}`}`. Il `div` non cambia il numero di celle della griglia.
  3. Test in `SetRow.test.tsx`: C5 (weight_reps con previous 80×8 e `max_set` 100×5: nella stessa cella "80 kg × 8" e sotto "max 100 kg × 5"; `reps` con `max_set` 20 rip: "max 20 rip"; `duration` con 90 s: "max 1:30"); C6 (`max_set: null` e campo assente: nessun testo "max"; senza precedente ma con massimo: "—" e "max …"); C7 (l'elemento del massimo ha le classi `truncate` e non è un `button`); C8 (con `previous` 77,5×8 e `max_set` 100×5, il tap su "Usa precedente serie 1" porta i campi a 77,5 e 8 e dopo 500 ms `onSave` riceve 77,5, 8); C9 (stesso numero di figli della griglia di T1).
- Verifica: `cd web && npm test`, risultato atteso: tutti i test passano, compresi quelli di T1 e quelli nuovi. `cd web && npm run build`: compila senza errori di tipo.

### [ ] T4. Fixture e test di pagina, dettaglio senza "max"

- Copre: C6, C10 (lato web), C11
- Rischio: basso
- File: `web/src/pages/gym/WorkoutPage.test.tsx` (modifica), `web/src/pages/gym/WorkoutDetailPage.test.tsx` (modifica)
- Passi:
  1. In `WorkoutPage.test.tsx` mantenere i set esistenti senza `max_set` (verificano il campo mancante) e aggiungere un test: con un set che ha `previous` 80×8 e `max_set` 100×5 la pagina mostra "max 100 kg × 5" sotto il precedente; con un set senza il campo non compare "max".
  2. In `WorkoutDetailPage.test.tsx` aggiungere l'asserzione che per un allenamento finito (set con `max_set: null`) il dettaglio non contiene testo che inizia con "max" e mostra le serie come prima.
- Verifica: `cd web && npm test`, risultato atteso: tutti i test passano.

### [ ] T5. Verifica remota del backend e controllo su iPhone

- Copre: C1, C2, C3, C4, C7, C10, C11
- Rischio: basso
- File: nessuno (solo esecuzione)
- Passi:
  1. Eseguire in locale `cd web && npm test` e `cd web && npm run build`; poi `git push origin feature/massimo-esercizio-allenamento`.
  2. Sul server remoto (lo esegue l'utente: preparargli un solo comando che stampi un esito breve): `git pull` del branch, `docker compose build api && docker compose up -d api`, quindi lanciare i test DB con un DB isolato come da nota di progetto (`docker compose run --rm -T -e DATABASE_URL=... -v "$PWD/api:/app" api sh -c "pip install -q pytest pytest-asyncio respx && python -m pytest tests/test_workouts_live.py tests/test_workouts_finish.py -q"`, dopo aver creato `yfp_test` e applicato `alembic upgrade head` su di esso). Giudicare la feature dai file di test propri, rilanciandoli più volte; confrontare la suite intera con una baseline solo se emergono fallimenti in altri file.
  3. Controllo manuale su iPhone o viewport 390px con un allenamento attivo che ha storico: la riga "max" appare sotto il precedente solo dove esiste, nessuno scroll orizzontale, campi kg/Rip. e tasto ✓ allineati; il tap sul precedente copia il precedente.
- Verifica: output dei test remoti `test_max_set_*` e `test_previous_follows_completed_position_skipping_incomplete` tutti verdi, nessun nuovo fallimento in `test_workouts_live.py` e `test_workouts_finish.py`; esito del controllo manuale annotato nel registro. Se un fallimento è dovuto al DB condiviso e non al codice, annotarlo senza dichiarare la feature verificata.

## Registro di esecuzione

- Partenza: 4a7376d987fa56ab2dfa58c0abd65dc38dd82770 su main
