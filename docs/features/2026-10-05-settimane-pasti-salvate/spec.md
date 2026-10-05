# Spec: Settimane di pasti salvate

- Data: 2026-10-05
- Tipo: feature
- Stato: completata
- Brainstorm: saltato

## Obiettivo

L'utente salva la settimana di pasti che vede nel diario come "settimana salvata" con un nome, e la ritrova in una sezione dedicata. Da lì la applica al diario tutta intera oppure solo ai giorni che sceglie, con la stessa esperienza di "Copia giorni" (data di inizio, pasti, aggiungi o sostituisci).

## Contesto tecnico

Storico delle decisioni rilevanti:

- La spec MCP ([2026-09-23-mcp-server-design.md](../../superpowers/specs/2026-09-23-mcp-server-design.md)) mette fuori scope "Piano dieta settimanale, template pasto (`MealTemplate` resta non esposto)". Resta valido per il server MCP: questa feature non aggiunge tool MCP. Resta valida anche la regola che i servizi sono condivisi tra REST e MCP (la logica va in `api/app/services/`, non nel router).
- La spec multi-utente ([2026-09-15-multi-user.md](../../plans/2026-09-15-multi-user.md)) ha lasciato fuori "API/UI per `meal_template`" e impone un filtro `user_id` su ogni query dei dati personali. Il README (sezione "Known gaps") dice ancora che `meal_template` esiste "come modello senza API né UI". Il "pasti salvati" citato nella richiesta quindi **non esiste come funzione**: esiste solo il modello dormiente.
- La spec della palestra ([2026-09-24-gym-workouts-design.md](../../superpowers/specs/2026-09-24-gym-workouts-design.md)) è il precedente per "salva come modello" (dal dettaglio di un allenamento), per le liste di modelli e per il pattern permesso + `ensure_permission` nei servizi.

Parti coinvolte:

- **Settimana (web).** `web/src/pages/WeekPage.tsx`: griglia di 7 `DayCell` (kcal e macro per giorno), checkbox per giorno, barra fissa "Copia N giorni…" sopra la tab bar (`bottom-[var(--nav-height)]`), data di inizio dalla query string `?start=` (default lunedì corrente con `startOfWeek` di `web/src/lib/date.ts`; le etichette Lun…Dom sono assegnate per indice, quindi assumono che `start` sia un lunedì). `web/src/components/CopyDaysDialog.tsx`: bottom sheet con data di inizio, pasti (checkbox, tutti di default, `meals: null` se tutti), modalità Aggiungi/Sostituisci (con descrizione "Cancella i pasti già presenti"), riepilogo "Copiati N pasti in M giorni". Test esistenti: `WeekPage.test.tsx`, `CopyDaysDialog.test.tsx`.
- **Hook web.** `web/src/api/queries.ts`: `useWeekDiary` (`["diary","week",start]`), `useCopyDays` (`POST /api/diary/copy`, invalida `["diary","week"]` e `["diary","day"]`), tipi `Meal`, `MEALS`, `CopyDaysInput`, `CopyDaysResponse`. Etichette pasti in `web/src/lib/meals.ts`.
- **Navigazione.** `web/src/App.tsx` (rotte sotto `AuthGuard` e `AppShell`), `web/src/components/AppShell.tsx` (4 tab dieta: Giorno, Cerca, Settimana, Statistiche; la tab Settimana è un `NavLink` senza `end`, quindi resta attiva su `/week/...`), `web/src/lib/appMode.ts` (`modeFromPath`: ogni path che inizia con `/week` è modalità dieta), `web/src/components/ModeSwitch.tsx` (header).
- **Copia giorni (API).** `POST /api/diary/copy` in `api/app/routers/diary.py` (richiede `Permission.diary_copy`), `copy_days` in `api/app/services/diary_ops.py` (legge tutte le entry sorgente prima di cancellare, cancella tutto, poi inserisce; posizioni con `_next_position`), `plan_copy` pura in `api/app/services/diary.py` (i giorni sorgente ordinati vanno posizionalmente su `target_start + i`; in `replace` ogni giorno di destinazione perde i pasti selezionati anche se il giorno sorgente è vuoto; lo snapshot dei nutrienti è copiato verbatim), schemi `DiaryCopyRequest`/`DiaryCopyResponse` in `api/app/schemas/diary.py`. Il server MCP espone la stessa operazione come tool `copy_days` (`api/app/mcp/tools/diary.py`).
- **Entry del diario.** `api/app/models/diary.py` (`DiaryEntry`: `food_id`, `date`, `meal`, `grams`, `portion_label`, `position`, `nutriments_snapshot` per 100 g non scalato); `create_entries` in `diary_ops.py` crea nuove entry copiando `Food.nutriments` corrente. I totali sono calcolati in `api/app/services/diary.py` (`compute_day_totals`).
- **Modello dormiente.** `api/app/models/meal_template.py` (`MealTemplate` e `MealTemplateItem`, con `quantity` e `portion_id`, senza giorno della settimana né slot pasto). Non è adatto a una settimana e resta com'è.
- **Modello dei modelli palestra** (da imitare per struttura, non da riusare): `api/app/routers/templates.py` e `api/app/services/templates.py` (router sottile, servizio con `ensure_permission`, `own_*` che restituisce `NotFound` per entità altrui), `web/src/pages/gym/WorkoutDetailPage.tsx` (conferma `window.confirm` prima di eliminare).
- **Permessi.** `api/app/permissions.py`: `Permission.diary_copy` ("Copia giorni del diario") è nei permessi di default. `web/src/auth/PermissionGuard.tsx` e `useHasPermission` per nascondere pagine e comandi.
- **Migrazioni.** `api/alembic/versions/`, head attuale `a6c1e4b8d203_body_weights.py`.

Vincoli: FastAPI + SQLAlchemy async + Alembic + Postgres; web React + TanStack Query + Tailwind; nessuna nuova dipendenza. Multi-utente: ogni lettura e scrittura filtrata per l'utente (entità altrui = `NotFound`/404). Nessun Postgres locale: i test DB (pytest) girano solo sul deploy remoto con `docker compose`; in locale girano i test web (`cd web && npm test`). Uso principale da iPhone come PWA: bottom sheet, target touch da 44 px, barra fissa sopra la tab bar.

### Scelte di design

- **Nuove tabelle, non `MealTemplate`.** Serve il giorno della settimana, lo slot pasto, i grammi e l'etichetta porzione, che `meal_templates` non ha. Una settimana salvata è un contenitore con nome (`saved_weeks`) e righe `saved_week_items` (giorno 0–6 con 0 = primo giorno della settimana salvata/lunedì, `meal`, `food_id`, `grams`, `portion_label`, `position`).
- **Contenuto salvato = ciò che c'è nel diario al momento del salvataggio**, giorno per giorno, senza il campo `date`. Le righe riferiscono il cibo (`food_id`, FK `RESTRICT` come nel diario), non uno snapshot dei nutrienti.
- **Applicazione = nuove entry del diario** create con i nutrienti correnti del cibo (come `create_entries`), perché sono nuove registrazioni e non una copia di storia passata. I totali mostrati nella sezione sono calcolati dal server dagli stessi nutrienti.
- **Applicazione con la stessa semantica di "Copia giorni"**: giorni scelti in ordine, mappati posizionalmente su `target_start + i`, filtro pasti, `append`/`replace`, cancellazioni prima degli inserimenti, `entries_created` e dettaglio per giorno nella risposta. L'implementazione deve riusare `plan_copy` (alimentandola con le righe salvate come sorgente), non duplicarne la logica.
- **Sezione dentro la modalità dieta**, sotto la tab Settimana: `/week/saved` (elenco) e `/week/saved/:id` (dettaglio). Così `modeFromPath` e la tab attiva funzionano senza modifiche e la barra a 4 tab non cambia.
- **Permesso**: tutto sotto `diary.copy` (è un'operazione di copia di massa sul diario), senza un nuovo permesso e senza migrazione di `users.permissions`.

## Impatto sull'esistente

- Comportamenti che cambiano:
  - in Settimana compaiono due comandi nuovi: "Salva settimana" e un accesso a "Settimane salvate" (visibili solo con `diary.copy`);
  - nuove pagine `/week/saved` e `/week/saved/:id` (mostrano la tab Settimana attiva e l'header con `ModeSwitch`);
  - la documentazione README (tabella API, sezione "Known gaps" su `meal_template`) va aggiornata: `meal_template` resta senza UI, ma le settimane salvate sono ora una funzione.
- Comportamenti da preservare:
  - Settimana: griglia a 7 giorni, colori contro l'obiettivo, navigazione precedente/successiva con `?start=`, checkbox per giorno, barra "Copia N giorni…", scorciatoia ⋯ per giorno, selezione azzerata al cambio settimana;
  - `CopyDaysDialog`: stessi campi, stesse etichette, stessa richiesta a `POST /api/diary/copy` (`source_dates`, `target_start`, `meals` nullo se tutti, `mode`), stesso riepilogo; se se ne estrae una parte condivisa, i test esistenti passano senza modifiche;
  - `POST /api/diary/copy`, `plan_copy` e `copy_days` (incluso il caso `replace` con date sovrapposte, lo svuotamento dei giorni di destinazione anche per giorni sorgente vuoti e lo snapshot copiato verbatim): nessun cambiamento di comportamento; tool MCP `copy_days` con stessi argomenti e output;
  - permesso `diary.copy` per la copia giorni: stessi stati 403 e stessa etichetta;
  - registrazione di una entry da Cerca e dal Giorno (`create_entries`, `update_entry`, `delete_entry`), posizioni (`position`) delle entry all'interno di un pasto;
  - barra tab a 4 voci (Giorno, Cerca, Settimana, Statistiche), modalità dieta/palestra e ultimo percorso ricordato per modalità;
  - modello `MealTemplate`/`MealTemplateItem` e le sue tabelle: non toccati;
  - isolamento per utente su ogni dato; barra fissa delle azioni sopra la tab bar (`--nav-height`).
- Compatibilità: retrocompatibile. Si aggiungono endpoint REST nuovi (`/api/saved-weeks...`) e rotte web nuove; nessun endpoint o formato esistente cambia. Nessuna variabile d'ambiente né dipendenza nuova.
- Migrazioni: una migrazione Alembic (nuovo head dopo `a6c1e4b8d203`) che crea `saved_weeks` (`id`, `user_id` FK `users.id` `ON DELETE CASCADE` con indice, `name` max 100, `created_at`) e `saved_week_items` (`id`, `saved_week_id` FK `ON DELETE CASCADE` con indice, `day_index` 0–6, `meal` con l'enum Postgres `meal` già esistente, `food_id` FK `foods.id` `ON DELETE RESTRICT`, `grams` `Numeric(10,2)`, `portion_label` `String(100)` nullabile, `position`). Nessuna migrazione di dati.

## Requisiti funzionali

- **R1**: dalla pagina Settimana l'utente salva la settimana visualizzata con un nome (obbligatorio, spazi ai bordi rimossi, 1–100 caratteri). Il sistema registra, per ognuno dei 7 giorni, tutte le entry del diario (pasto, cibo, grammi, etichetta porzione, ordine) senza le date. Il nome non deve essere unico.
- **R2**: il salvataggio è rifiutato con errore esplicito se la settimana non ha nessuna entry, o se la data di inizio non è un lunedì. La richiesta REST passa la data di inizio (`start`), non l'elenco delle entry: è il server a leggere il diario.
- **R3**: la pagina `/week/saved` elenca le settimane salvate dell'utente (nome, data di salvataggio, numero di pasti registrati, kcal medie per giorno con entry), dalla più recente. Con zero settimane mostra uno stato vuoto che rimanda a Settimana. Da Settimana c'è un accesso a questa pagina.
- **R4**: la pagina `/week/saved/:id` mostra i 7 giorni della settimana salvata (Lun…Dom) con kcal e macro totali di ciascuno e i cibi raggruppati per pasto con i grammi; i giorni senza pasti sono mostrati come vuoti. Un id inesistente o di un altro utente dà uno stato "non trovata" (404 lato API).
- **R5**: nel dettaglio l'utente applica l'intera settimana con un comando "Applica settimana…", oppure spunta uno o più giorni e usa la barra fissa "Applica N giorni…", come in Settimana per "Copia N giorni…".
- **R6**: il comando apre una finestra (bottom sheet) con gli stessi campi di "Copia giorni": data di inizio, pasti da applicare (tutti di default), modalità Aggiungi/Sostituisci (con le stesse descrizioni). Al successo mostra "Applicati N pasti in M giorni".
- **R7**: l'applicazione crea nuove entry del diario. I giorni scelti, in ordine di giorno della settimana, vanno sui giorni consecutivi da `target_start` in poi (primo scelto su `target_start`, secondo sul giorno dopo, ecc., come in "Copia giorni"). Con `append` le entry esistenti restano e le nuove vanno in coda per ogni pasto; con `replace` i pasti selezionati dei giorni di destinazione sono cancellati prima, anche se il giorno salvato è vuoto. Le entry nuove usano i nutrienti correnti del cibo.
- **R8**: l'utente rinomina una settimana salvata (stessa regola del nome di R1) e la elimina, con conferma `window.confirm` prima dell'eliminazione. L'eliminazione non tocca le entry già applicate al diario.
- **R9**: tutte le operazioni sulle settimane salvate richiedono `diary.copy`. Senza permesso, le API rispondono 403 come `POST /api/diary/copy`, e il web non mostra "Salva settimana", "Settimane salvate" né permette di aprire `/week/saved...` (reindirizza al Giorno come `PermissionGuard`).
- **R10**: dopo l'applicazione la cache del diario (`["diary","week"]`, `["diary","day"]`) è invalidata, così Giorno e Settimana mostrano subito i dati nuovi; dopo salvataggio, rinomina o eliminazione è invalidata la cache delle settimane salvate.

API (indicativa, sotto `/api`, autenticata, tutto con `diary.copy`):

- `POST /saved-weeks` con `{name, start}` → 201 con il riepilogo;
- `GET /saved-weeks` → elenco;
- `GET /saved-weeks/{id}` → dettaglio con i 7 giorni, totali per giorno e righe per pasto;
- `PATCH /saved-weeks/{id}` con `{name}`;
- `DELETE /saved-weeks/{id}` → 204;
- `POST /saved-weeks/{id}/apply` con `{days: [0..6] | null, target_start, meals: [..] | null, mode}` → stessa risposta di `POST /api/diary/copy` (`entries_created` e `days`); `days` nullo significa tutti e 7 i giorni, un elenco vuoto è un errore 400.

## Requisiti non funzionali

- Sicurezza: ogni query filtra per `user_id`; settimane altrui sono `NotFound`. La logica è nei servizi (`api/app/services/`), non nel router. La modalità `replace` è eseguita in una sola transazione (tutto o niente).
- Prestazioni: una settimana ha al massimo qualche decina di righe; il dettaglio carica righe e cibi in poche query (niente N+1 per riga).
- Mobile: bottom sheet con padding `var(--safe-bottom)`, target da 44 px, barra fissa sopra la tab bar come in `WeekPage`.
- Test: servizi e router coperti da pytest (girano solo sul deploy remoto); componenti e pagine web da vitest con i mock di `../api/...` come in `WeekPage.test.tsx`.

## Criteri di accettazione

- **C1** (R1): Dato un utente con `diary.copy` e una settimana con entry in Pranzo di lunedì e Cena di giovedì, quando salva la settimana col nome "Dieta A", allora esiste una settimana salvata "Dieta A" con quelle entry nei giorni 0 e 3, con gli stessi cibi, grammi ed etichette porzione.
- **C2** (R2): Dato un periodo senza nessuna entry, quando prova a salvare, allora la richiesta è rifiutata e non viene creata nessuna settimana salvata. Lo stesso per un `start` che non è un lunedì e per un nome vuoto o di soli spazi.
- **C3** (R3): Dato che l'utente ha due settimane salvate, quando apre `/week/saved`, allora le vede in ordine dalla più recente con nome e numero di pasti; senza settimane vede lo stato vuoto.
- **C4** (R4): Dato il dettaglio di "Dieta A", quando lo apre, allora vede 7 giorni Lun…Dom con kcal e macro coerenti con grammi e nutrienti dei cibi e i cibi per pasto; i giorni senza pasti risultano vuoti.
- **C5** (R4, R9): Dato l'id di una settimana di un altro utente, quando la richiede, allora la risposta è 404 e il web mostra "non trovata".
- **C6** (R5, R6, R7): Dato "Dieta A" aperta, quando l'utente preme "Applica settimana…", sceglie come inizio un lunedì futuro, lascia tutti i pasti e "Aggiungi" e conferma, allora il diario di quei 7 giorni contiene le entry salvate (ogni giorno sul giorno corrispondente) e vede "Applicati N pasti in 7 giorni".
- **C7** (R5, R7): Dato che l'utente spunta solo martedì e giovedì e preme "Applica 2 giorni…" con inizio il 2026-10-12, quando conferma, allora le entry del martedì finiscono il 2026-10-12 e quelle del giovedì il 2026-10-13 (stessa regola posizionale di "Copia giorni"), e nessun altro giorno è toccato.
- **C8** (R7, append): Dato che il giorno di destinazione ha già una colazione, quando applica con "Aggiungi", allora le entry esistenti restano e le nuove vanno dopo, con `position` successive.
- **C9** (R7, replace): Dato che il giorno di destinazione ha già pasti, quando applica con "Sostituisci" e il filtro pasti è solo Pranzo, allora i pranzi esistenti di quel giorno sono sostituiti e colazione, cena e spuntino restano.
- **C10** (R6): Dato che l'utente deseleziona tutti i pasti o non ha scelto la data di inizio, allora "Applica" è disabilitato.
- **C11** (R7): Dato che un cibo di una riga salvata ha nutrienti diversi da quando è stato salvato, quando la settimana è applicata, allora le nuove entry hanno i nutrienti correnti del cibo.
- **C12** (R8): Dato "Dieta A", quando l'utente la rinomina in "Dieta B", allora l'elenco mostra "Dieta B". Quando la elimina e conferma, allora sparisce dall'elenco e le entry già applicate al diario restano; se annulla la conferma, non succede nulla.
- **C13** (R9): Dato un utente senza `diary.copy`, quando chiama una qualsiasi API delle settimane salvate, allora riceve 403; nel web non vede "Salva settimana" né "Settimane salvate" e `/week/saved` reindirizza al Giorno.
- **C14** (R10): Dopo un'applicazione riuscita, aprendo Giorno o Settimana per le date interessate, i dati nuovi sono visibili senza ricaricare la pagina.
- **C15** (preservare): Dato il flusso esistente di Settimana, quando l'utente spunta dei giorni, preme "Copia N giorni…" e conferma in "Copia giorni", allora la richiesta a `POST /api/diary/copy` e il risultato sono identici a prima.
- **C16** (preservare): Dato `POST /api/diary/copy` con `mode: "replace"` e date sorgente e destinazione sovrapposte, quando è eseguito, allora il risultato è identico a prima (i test `test_diary_copy.py` e `test_diary_copy_service.py` restano verdi senza modifiche).
- **C17** (preservare): Dato un utente senza `diary.copy`, quando chiama `POST /api/diary/copy`, allora riceve 403 come prima.
- **C18** (preservare): Dato il menu in basso, quando si apre una qualsiasi pagina dieta, allora le tab sono Giorno, Cerca, Settimana, Statistiche; su `/week/saved` e `/week/saved/:id` la tab Settimana è attiva e la modalità è dieta.
- **C19** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano, anche quelli esistenti.
- **C20** (non regressione): Eseguendo `pytest` sul deploy remoto (`docker compose`), tutti i test passano, compresi i nuovi test dei servizi e del router delle settimane salvate.

## Fuori scope

- Modificare il contenuto di una settimana salvata (aggiungere, togliere o cambiare cibi e grammi). Per cambiarla si salva una nuova settimana dal diario e si elimina la vecchia.
- "Pasti salvati" singoli o per giorno (l'uso del modello `MealTemplate`) e la loro UI.
- Tool MCP per le settimane salvate (la spec MCP lascia fuori i template pasto), anche se la logica è già in un servizio condiviso.
- Cartelle, preferiti, riordino manuale, condivisione tra utenti, importazione/esportazione.
- Salvare un sottoinsieme di giorni (si salva sempre la settimana intera; i giorni da usare si scelgono all'applicazione).
- Pianificazione automatica (applicare una settimana ricorrente o programmata) e promemoria.
- Mantenere la distanza tra giorni non consecutivi scelti (decisione utente): si segue la regola di "Copia giorni".
- Modifiche a `CopyDaysDialog`, a `plan_copy` o alla copia giorni esistente, oltre a un'eventuale estrazione di parti condivise senza cambiarne il comportamento.
- Tab nuova nella barra di navigazione.

## Rischi

- **Settimana non iniziante di lunedì.** `WeekPage` accetta un `?start=` qualsiasi e assegna le etichette Lun…Dom per indice. Mitigazione: il salvataggio rifiuta un `start` non lunedì con messaggio chiaro (R2) e il comando "Salva settimana" resta disponibile solo se `start` è un lunedì.
- **`replace` con giorni vuoti.** Come in "Copia giorni", applicare "intera settimana" in `replace` svuota i pasti selezionati anche nei giorni di destinazione corrispondenti a giorni salvati vuoti. Mitigazione: la descrizione di "Sostituisci" (già "Cancella i pasti già presenti") resta visibile e il riepilogo mostra i giorni toccati.
- **Divergenza tra `plan_copy` e applicazione.** Reimplementare la mappatura dei giorni lo farebbe divergere dalla copia. Mitigazione: usare `plan_copy` con righe sorgente "finte" mappate su date di appoggio, con test che confrontano il risultato con quello della copia.
- **Cibo cambiato dopo il salvataggio.** I nutrienti sono quelli correnti (C11): i totali del dettaglio possono differire da quelli del diario originale. Accettato: è il comportamento di una nuova registrazione.
- **Test DB solo sul deploy remoto.** Nessun test DB locale: le verifiche pytest si fanno dopo il push del branch e il `git pull` sul server.
