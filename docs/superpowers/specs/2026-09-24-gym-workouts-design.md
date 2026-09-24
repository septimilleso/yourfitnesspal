# Sezione Palestra: esercizi, modelli e allenamenti (stile Strong)

## Problema

L'app gestisce solo la dieta. Serve una sezione palestra in stile Strong: catalogo esercizi,
modelli di allenamento organizzati in cartelle, sessione live con serie da spuntare, timer di
riposo, storico e aggiornamento del modello quando cambiano pesi o ripetizioni.

## Decisioni

- Catalogo da [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)
  (876 esercizi, licenza Unlicense), **senza immagini**, **nomi e istruzioni in inglese**.
  L'interfaccia resta in italiano.
- Il JSON ridotto è versionato nel repo e caricato da una **migrazione Alembic di dati**
  (upsert per `source_id`). Nessuna chiamata di rete a runtime.
- Esercizi **personalizzati** semplici e privati per utente.
- Allenamento in corso **salvato sul server a ogni modifica**: sopravvive a reload e cambio
  dispositivo. Richiede rete.
- Timer di riposo **solo in-app** (beep WebAudio + vibrazione), basato su un istante assoluto
  `rest_ends_at`, quindi corretto anche dopo standby.
- A fine allenamento, se differisce dal modello, il riepilogo **chiede conferma** prima di
  aggiornare il modello.
- Inclusi: cartelle modelli, storico allenamenti, superserie, tool MCP.
- Navigazione: selettore **Dieta | Palestra** nell'header che cambia la tab bar.
- Unità: solo kg.

### Fuori scope

- Statistiche, grafici, record personali, conteggi, volume totale.
- Notifiche push, funzionamento offline.
- Tipi di serie (riscaldamento, drop set, cedimento).
- Modifica di allenamenti già finiti (solo eliminazione).
- Traduzione del catalogo, immagini degli esercizi.
- Esercizi a distanza (cardio con km): il cardio usa il tracking `duration`.

## Architettura

Stesso schema delle feature esistenti: `models/` → `services/` (logica DB condivisa da REST e
MCP) → `routers/` sottili → `mcp/tools/`. Errori di dominio da `services/errors.py`
(`NotFound`, `Invalid`, `PermissionMissing`).

### File nuovi (API)

- `api/app/data/exercises.json`: catalogo ridotto (vedi "Catalogo").
- `api/app/data/README.md`: provenienza, commit sorgente, licenza, script di rigenerazione.
- `api/scripts/build_exercises.py`: scarica `dist/exercises.json` da un commit fissato e
  produce il file ridotto (tiene `id, name, equipment, primaryMuscles, secondaryMuscles,
  category, instructions`, calcola `tracking`).
- `api/app/models/exercise.py`: `Exercise`, `Tracking`.
- `api/app/models/workout.py`: `TemplateFolder`, `WorkoutTemplate`, `TemplateExercise`,
  `TemplateSet`, `Workout`, `WorkoutExercise`, `WorkoutSet`, `WorkoutStatus`.
- `api/app/schemas/exercise.py`, `api/app/schemas/workout.py`.
- `api/app/services/exercises.py`: ricerca, CRUD custom.
- `api/app/services/templates.py`: CRUD cartelle e modelli, riordino, duplica.
- `api/app/services/workouts.py`: avvio, modifiche live, "precedente", fine, diff, storico.
- `api/app/routers/exercises.py`, `api/app/routers/templates.py`,
  `api/app/routers/workouts.py`.
- `api/app/mcp/tools/workouts.py`: `register_workout_tools(server)`.
- Migrazioni: `<rev>_gym_schema.py` (tabelle + permesso) e `<rev>_gym_exercise_catalog.py`
  (dati).

Tutti i modelli vanno riesportati in `app/models/__init__.py`. I router si registrano in
`main.py` con `dependencies=[Depends(get_current_user)]`.

## Catalogo

Ogni voce del JSON ridotto:

```json
{"id": "Barbell_Squat", "name": "Barbell Squat", "equipment": "barbell",
 "primary_muscles": ["quadriceps"], "secondary_muscles": ["calves", "glutes"],
 "category": "strength", "instructions": ["..."], "tracking": "weight_reps"}
```

Regola `tracking` (applicata dallo script):

1. `category` in (`stretching`, `cardio`) → `duration`
2. altrimenti `equipment` = `body only` → `reps`
3. altrimenti → `weight_reps`

La migrazione dati legge il file e fa `INSERT ... ON CONFLICT (source, source_id) DO UPDATE`
sui campi descrittivi. Non elimina mai righe (possono essere referenziate dallo storico). Un
futuro aggiornamento del catalogo è una nuova migrazione che rilegge il file.

## Modello dati

Tutti i timestamp sono `timestamptz`. Le FK verso `users.id` sono `ondelete=CASCADE` e
indicizzate. `position` è un intero 0-based, riscritto per intero a ogni riordino.

### `exercises`

| colonna | tipo | note |
|---|---|---|
| id | int PK | |
| source | varchar(16) | `catalog` \| `custom` |
| source_id | varchar(128) null | id del catalogo; null per custom |
| owner_user_id | FK users null | solo per custom |
| name | varchar(255) | indice trigram |
| equipment | varchar(32) null | valori del catalogo |
| primary_muscles | varchar[] | |
| secondary_muscles | varchar[] | |
| category | varchar(32) null | |
| instructions | varchar[] | vuoto per custom |
| tracking | enum `tracking` | `weight_reps` \| `reps` \| `duration` |
| archived_at | timestamptz null | eliminazione logica dei custom |

Vincoli:
- `ck_exercises_owner_only_custom`: `source = 'custom'` se e solo se `owner_user_id` non è null.
- Unico `(source, source_id)`.

Un esercizio custom "eliminato" riceve `archived_at`: sparisce da ricerca e selezione, ma
storico e modelli esistenti continuano a mostrarlo.

### `template_folders`

`id`, `user_id`, `name` (varchar 100), `position`.
Eliminare una cartella sposta i suoi modelli fuori cartella (`folder_id = null`).

### `workout_templates`

`id`, `user_id`, `folder_id` (FK `template_folders`, `ondelete=SET NULL`), `name` (varchar 100),
`position` (dentro la cartella o tra i modelli senza cartella), `last_used_at` null,
`created_at`, `updated_at`.

### `template_exercises`

`id`, `template_id` (CASCADE), `exercise_id` (FK `exercises`, `RESTRICT`), `position`,
`rest_seconds` (int, 0–600, default 90), `superset_group` (int null), `note` (varchar 500 null).

### `template_sets`

`id`, `template_exercise_id` (CASCADE), `position`, `weight_kg` (numeric(6,2) null),
`reps` (int null), `duration_s` (int null).

### `workouts`

`id`, `user_id`, `template_id` (FK, `SET NULL`), `name`, `status` (enum `workout_status`:
`in_progress` \| `finished`), `started_at`, `finished_at` null, `rest_ends_at` null,
`rest_total_s` null (durata del timer corrente, per la barra di avanzamento).

Indice unico parziale `ux_workouts_one_in_progress` su `user_id` dove
`status = 'in_progress'`. Indice `(user_id, finished_at desc)` per lo storico.

### `workout_exercises`

Come `template_exercises`, ma con `workout_id` al posto di `template_id`.

### `workout_sets`

Come `template_sets`, più `completed_at` null.

### Regole su serie e superserie

- Campi valorizzati per tracking: `weight_reps` → `weight_kg` + `reps`; `reps` → `reps`
  (`weight_kg` opzionale come zavorra); `duration` → `duration_s`. Il service valida alla
  spunta, non durante la digitazione: una serie può essere salvata incompleta, ma non spuntata.
- Limiti: `weight_kg` 0–1000 (passo libero, 2 decimali), `reps` 0–1000, `duration_s` 0–36000.
- `superset_group`: esercizi consecutivi con lo stesso valore formano una superserie. Il service
  normalizza i gruppi a ogni salvataggio: un gruppo con un solo esercizio torna `null`, gruppi
  non consecutivi vengono separati.

### Permesso

Nuovo `Permission.workouts = "workouts.use"`, etichetta "Allenamenti", incluso in
`DEFAULT_PERMISSIONS`. La migrazione schema lo aggiunge a `users.permissions` di tutti gli
utenti esistenti. Ogni service lo verifica con `ensure_permission`.

## Logica del service `workouts`

### Avvio

- `start_workout(user, template_id | None)`: errore `Invalid` se esiste già un workout
  `in_progress` (la UI riprende quello). Da modello: copia esercizi, serie, riposi e superserie,
  imposta `last_used_at` del modello. Vuoto: nome "Allenamento" + data.
- `get_active(user)`: il workout in corso o `null`.

### Modifiche live

Endpoint granulari, ognuno una transazione:
- aggiungi, rimuovi, sostituisci esercizio; modifica `rest_seconds` e `note`;
- ordine e superserie di tutti gli esercizi insieme (`PUT .../layout`, normalizzato dal server);
- aggiungi serie (copia i valori dell'ultima serie dell'esercizio), modifica, elimina;
- rinomina il workout.

Tutti rispondono con il workout completo aggiornato: la SPA sostituisce la cache con la risposta.

### Spunta serie e timer

`complete_set(set_id, valori?)` salva prima i valori inviati con la spunta (così nulla di
digitato va perso), valida i campi e imposta `completed_at = now()`. Poi calcola il riposo:

- esercizio non in superserie → `rest_seconds` dell'esercizio;
- in superserie → timer solo se ogni esercizio del gruppo ha una serie completata alla stessa
  `position` (fine del giro); si usa il `rest_seconds` dell'ultimo esercizio del gruppo;
- `rest_seconds = 0` → nessun timer.

Se c'è un timer: `rest_ends_at = now() + rest`, `rest_total_s = rest`.
`uncomplete_set` azzera `completed_at` e non tocca il timer.
`POST .../rest` accetta esattamente una tra `start_s` (timer manuale), `delta_s` (±15) e `skip`.

### Precedente

`previous_sets(user, exercise_ids)`: per ogni esercizio, le serie completate dell'ultimo workout
`finished` che lo contiene, per `position`. La risposta del workout attivo include per ogni serie
un campo `previous` (`{weight_kg, reps, duration_s}` o `null`), ricavato per posizione.
Precompilazione: da modello si usano i valori del modello. Nell'allenamento vuoto o per un
esercizio aggiunto, la nuova serie prende i valori da `previous` se esiste.

### Fine

`finish_workout(workout_id, discard_incomplete: bool)`:
- se ci sono serie non completate e `discard_incomplete` è falso → `Invalid` con codice
  `incomplete_sets` (la UI chiede conferma);
- elimina le serie non completate e gli esercizi rimasti senza serie;
- nessuna serie completata → `Invalid` (`empty_workout`), la UI propone "Annulla allenamento";
- imposta `status = finished`, `finished_at`, azzera il timer;
- risponde con il workout finito, che include `template_diff`.

Ogni `WorkoutOut` di un workout finito con modello include `template_diff` (lista vuota dopo
"Aggiorna modello"), così il riepilogo sopravvive a un reload.

`cancel_workout(workout_id)` elimina il workout in corso.

### Diff col modello

`template_diff(workout)`, solo se `template_id` non è null e il modello esiste ancora. Confronta
la struttura finale del workout con il modello e restituisce una lista di voci leggibili:

- esercizio aggiunto o rimosso;
- per esercizio (abbinato per `exercise_id` e ordine di comparsa): serie aggiunte o rimosse,
  valori cambiati per posizione (`80 → 85 kg`, `8 → 10 rip`), riposo cambiato;
- ordine o superserie cambiati (una voce generica).

Lista vuota → nessuna domanda.

`apply_to_template(workout_id)`: sostituisce esercizi e serie del modello con quelli del workout
finito (valori delle serie completate, riposi, superserie, note). Il nome del modello resta.
`save_as_template(workout_id, name, folder_id?)` crea un nuovo modello dal workout finito.

### Storico

- `list_workouts(user, before?, limit=20)`: finiti, ordinati per `finished_at` desc, paginazione
  a cursore. Ogni voce: nome, data, durata, nomi degli esercizi con numero di serie.
- `get_workout(user, id)`: dettaglio con tutte le serie.
- `delete_workout(user, id)`.

Ogni lettura e scrittura filtra per `user_id`. Un id di un altro utente produce `NotFound`.

## API per la SPA

Tutte sotto `/api`, autenticate, con il permesso `workouts.use`.

| metodo | path | scopo |
|---|---|---|
| GET | `/exercises?q=&equipment=&muscle=&limit=&offset=` | ricerca catalogo + custom dell'utente |
| GET | `/exercises/{id}` | dettaglio |
| POST / PATCH / DELETE | `/exercises[/{id}]` | custom (DELETE = archivia) |
| GET | `/templates` | cartelle e modelli con anteprima esercizi |
| POST / PATCH / DELETE | `/template-folders[/{id}]` | cartelle |
| POST | `/templates` | crea (corpo completo: esercizi e serie) |
| GET / PUT / DELETE | `/templates/{id}` | leggi, sostituisci per intero, elimina |
| POST | `/templates/{id}/duplicate` | duplica ("Copia") |
| PATCH | `/templates/{id}` | rinomina, sposta cartella |
| GET | `/workouts/active` | workout in corso o 204 |
| POST | `/workouts` | avvia (`template_id` opzionale) |
| PATCH | `/workouts/{id}` | rinomina |
| POST | `/workouts/{id}/exercises` | aggiungi esercizio |
| PATCH / DELETE | `/workouts/{id}/exercises/{we_id}` | riposo, nota, sostituisci, rimuovi |
| PUT | `/workouts/{id}/layout` | ordine e superserie di tutti gli esercizi |
| POST | `/workouts/{id}/exercises/{we_id}/sets` | aggiungi serie |
| PATCH / DELETE | `/workouts/{id}/sets/{set_id}` | modifica valori, elimina |
| POST | `/workouts/{id}/sets/{set_id}/complete` · `/uncomplete` | spunta (complete accetta i valori) |
| POST | `/workouts/{id}/rest` | `{"start_s": 90}`, `{"delta_s": 15}` oppure `{"skip": true}` |
| POST | `/workouts/{id}/finish` | `{"discard_incomplete": bool}` → workout finito con diff |
| POST | `/workouts/{id}/apply-to-template` | aggiorna modello |
| POST | `/workouts/{id}/save-as-template` | `{name, folder_id?}` |
| DELETE | `/workouts/{id}` | annulla in corso / elimina dallo storico |
| GET | `/workouts?before=&limit=` | storico |
| GET | `/workouts/{id}` | dettaglio |

L'editor modelli lavora in locale e salva con un unico `PUT /templates/{id}`. La sessione live
invece salva ogni modifica subito. Nessun riordino manuale di cartelle e modelli nella v1:
cartelle in ordine di creazione, un modello spostato va in fondo alla cartella.

## UI (web)

### Navigazione

- `AppShell` riceve una modalità `diet | gym`, derivata dal path (`/gym/*` → gym). Il selettore
  segmentato `Dieta | Palestra` sta nell'header. Cambiare modalità porta all'ultima pagina
  visitata di quella modalità (ricordata in `localStorage`, con try/catch).
- Tab Palestra: **Storico** `/gym/history`, **Inizia** `/gym`, **Esercizi** `/gym/exercises`,
  **Impostazioni** `/settings` (condivisa).
- Senza permesso `workouts.use` il selettore non compare.

### Inizia (`/gym`)

- Pulsante pieno "Inizia un allenamento vuoto". Se c'è un workout in corso diventa
  "Riprendi allenamento".
- Intestazione "Modelli" con `+ Template` e icona cartella (nuova cartella).
- Cartelle comprimibili "Nome (n)" con menu `…` (Rinomina, Elimina); in fondo i modelli senza
  cartella.
- Griglia di card a 2 colonne: nome, esercizi separati da virgola (troncati a 3 righe),
  "ultimo uso" relativo ("Ieri", "6 giorni fa", data). Menu `…`: Modifica, Duplica,
  Sposta in cartella, Elimina.
- Tap su una card: foglio anteprima (esercizi con numero di serie) e "Inizia allenamento".

### Editor modello (`/gym/templates/new`, `/gym/templates/:id`)

Nome, cartella, lista esercizi. Per esercizio: serie con kg/rip (o rip, o durata `m:ss`),
"+ Aggiungi serie", riposo (picker 0:00–10:00, passi da 15s), frecce su/giù, "Collega al
successivo" (superserie), rimuovi. "+ Aggiungi esercizio" apre il selettore esercizi.
Salva / Annulla.

### Selettore esercizi

Foglio con ricerca, filtri attrezzo e muscolo, selezione multipla, "+ Nuovo esercizio".
Riusato da editor e sessione live.

### Sessione live (`/gym/workout`)

- Foglio a tutto schermo. Header: pulsante timer (riposo manuale), cronometro dall'inizio,
  pulsante verde "Termina". Nome del workout modificabile.
- Per esercizio: nome in blu (tap = dettaglio esercizio), icona superserie, menu `…`
  (Sostituisci, Riposo, Nota, Rimuovi). Una barra colorata a sinistra unisce gli esercizi della
  stessa superserie.
- Righe serie: `Serie | Precedente | kg | Rip. | ✓`. Le colonne seguono il tracking (`reps`:
  senza kg; `duration`: una colonna `Tempo`). "Precedente" è grigio (`80 kg × 8`, `—` se
  assente); tap su "Precedente" copia i valori nei campi. Serie spuntata: riga verde.
  Tap sul numero della serie: menu con Elimina.
- Tra due serie una linea con il riposo (`1:30`). Tap → picker del riposo dell'esercizio.
- "+ Aggiungi serie (1:30)" sotto ogni esercizio; "+ Aggiungi esercizio" e
  "Annulla allenamento" in fondo.
- Campi numerici: `inputmode="decimal"`, accettano la virgola. Salvataggio con debounce 500 ms e
  al blur. Il ✓ invia prima eventuali modifiche in sospeso.
- Timer di riposo: barra fissa in alto con countdown `m:ss`, avanzamento, `-15s`, `+15s`,
  `Salta`. Il tempo si calcola da `rest_ends_at` (con correzione dell'offset orologio
  server/client ricavato dal campo `server_now` di ogni risposta). A zero: beep WebAudio breve (AudioContext
  sbloccato al primo tap del ✓) e `navigator.vibrate([200,100,200])` se disponibile.
- Barra "Allenamento in corso · 12:34" sopra la tab bar in tutte le pagine, anche in modalità
  Dieta, che riapre la sessione.
- Errori: toast con il messaggio ("Non salvato: controlla la connessione" per la rete) e retry
  automatico dei soli errori di rete; lo stato del campo resta quello digitato. Tutte le
  modifiche live girano in un'unica coda react-query (`scope`), quindi arrivano in ordine.

### Termina e riepilogo

1. "Termina" → se ci sono serie non spuntate: dialogo "Ci sono N serie non completate.
   Verranno scartate." [Annulla] [Termina].
2. Riepilogo (`/gym/history/:id?summary=1`): nome, data, durata, esercizi con le serie fatte.
3. Se `template_diff` non è vuoto: riquadro "Modifiche rispetto al modello" con la lista e i
   pulsanti "Aggiorna modello" / "Mantieni modello".
4. Workout senza modello: pulsante "Salva come modello".

### Storico (`/gym/history`)

Lista raggruppata per mese; card con nome, data, durata, esercizi (`3 × Squat (Barbell)`).
Pulsante "Carica altri". Dettaglio: serie per esercizio, menu con Elimina e "Salva come modello".

### Esercizi (`/gym/exercises`)

Ricerca, filtri attrezzo e muscolo (etichette italiane per attrezzi e muscoli in
`web/src/lib/gym.ts`, nomi degli esercizi in inglese), lista alfabetica con attrezzo e muscolo
primario. Dettaglio: muscoli, categoria, istruzioni (EN). "+" crea un custom: nome, attrezzo,
muscolo primario, tracking. I custom si modificano ed eliminano (archiviazione).

### Codice frontend

- `web/src/api/gym.ts`: tipi e hook react-query (`["gym","exercises",...]`,
  `["gym","templates"]`, `["gym","workout","active"]`, `["gym","history",...]`). Le mutation live
  scrivono la risposta direttamente in `["gym","workout","active"]`.
- Pagine in `web/src/pages/gym/`, componenti in `web/src/components/gym/`
  (`SetRow`, `RestTimerBar`, `ExercisePicker`, `ActiveWorkoutBar`, `TemplateCard`, ...).
- Dialoghi semplici (nome cartella, nota, conferme) con `window.prompt` / `window.confirm`.
- `web/src/lib/restTimer.ts`: calcolo del tempo residuo e beep, testabile senza DOM.
- PWA: nessuna cache runtime per `/api/workouts` e `/api/templates`.

## Tool MCP

In `api/app/mcp/tools/workouts.py`. Richiedono `mcp.access` e `workouts.use`, con audit come i
tool esistenti:

- `search_exercises(query, equipment?, muscle?, limit=20)`
- `list_workout_templates()`: cartelle e modelli con esercizi
- `get_workout_template(template_id)`
- `create_workout_template(name, folder?, exercises=[{exercise_id, sets:[{weight_kg?, reps?,
  duration_s?}], rest_seconds?}])`: la cartella si indica per nome e viene creata se manca
- `list_workouts(limit=10, before?)`
- `get_workout(workout_id)`

Nessun tool agisce sulla sessione live. Aggiornare `instructions` in `mcp/server.py` con una riga
sulla palestra.

## Test

API (pytest, DB reale, fixture `db` esistente):
- migrazione del catalogo: conteggio righe, regola `tracking`, idempotenza dell'upsert;
- esercizi: ricerca per nome e filtri, custom visibili solo al proprietario, archiviazione;
- modelli: CRUD, riordino, duplica, eliminazione cartella → modelli fuori cartella,
  isolamento per utente;
- workout: un solo `in_progress` per utente, avvio da modello copia valori e aggiorna
  `last_used_at`, spunta con validazione per tracking, timer normale / superserie (solo a fine
  giro) / `rest_seconds = 0`, `adjust_rest` e `skip_rest`, `previous` per posizione dall'ultimo
  workout finito, fine con `incomplete_sets` ed `empty_workout`, diff (valori, serie, esercizi,
  riposo), `apply_to_template`, `save_as_template`, storico paginato, accesso cross-utente →
  404, permesso mancante → 403;
- MCP: un test per tool, più il permesso mancante.

Web (Vitest + Testing Library):
- `restTimer`: tempo residuo con offset orologio, clamp a zero;
- `SetRow`: colonne per tracking, tap su Precedente copia i valori, ✓ invia prima il valore in
  sospeso;
- sessione live: ✓ mostra la barra timer, `+15s` / `Salta` chiamano l'endpoint;
- riepilogo: diff visibile solo se non vuoto, "Aggiorna modello" chiama l'endpoint;
- `AppShell`: il selettore cambia tab bar; la barra "Allenamento in corso" appare se c'è un
  workout attivo.

I test del DB girano sul deploy remoto (niente Postgres locale).

## Criteri di accettazione

1. Dopo `alembic upgrade head` il catalogo contiene 876 esercizi, senza immagini.
2. Creo una cartella "Settimana 1" e un modello "Giorno 1" con Squat 4×8 a 80 kg e riposo 1:30.
3. Avvio il modello: vedo "Precedente" vuoto la prima volta e i campi precompilati a 80 × 8.
4. Spuntare una serie avvia il timer da 1:30 con `-15s`, `+15s`, `Salta`; a zero suona e vibra.
5. Ricaricando la pagina a metà, allenamento e timer restano.
6. Cambio la serie 1 a 85 kg, termino: il riepilogo mostra "Squat: serie 1 80 kg × 8 → 85 kg × 8" e
   "Aggiorna modello" aggiorna il modello.
7. Il successivo avvio mostra "Precedente" `85 kg × 8` sulla serie 1.
8. In una superserie A+B il timer parte solo dopo il ✓ di B.
9. Lo storico elenca l'allenamento con il dettaglio delle serie.
10. Via MCP, Claude elenca i modelli e ne crea uno nuovo che compare nella pagina Inizia.
