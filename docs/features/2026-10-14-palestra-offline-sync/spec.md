# Spec: Palestra offline nell'IPA con stato locale e sync a blocco

- Data: 2026-10-14
- Tipo: feature
- Stato: approvato
- Brainstorm: [brainstorm.md](brainstorm.md)

## Obiettivo

Nell'IPA un allenamento completo, dall'avvio alla fine, si svolge senza rete: l'allenamento vive in uno stato locale salvato su file, mostra Precedente e Max e si sincronizza da solo con il server quando torna la rete. Misura: in modalità aereo si avvia un modello, si segnano tutte le serie e si finisce; tornata la rete, lo stesso allenamento compare nello Storico del server con gli stessi dati.

## Contesto tecnico

Decisioni di riferimento: [ADR 0004](../../decisions/0004-palestra-offline-sync-a-blocco.md) con l'aggiornamento del 2026-10-14 (file JSON in `Directory.Library`, snapshot server per Precedente e Max, versione e 409 con scelta dell'utente) e [ADR 0003](../../decisions/0003-auth-bearer-client-nativo.md) (Bearer per l'IPA, `X-Requested-With` sempre richiesto). Il design originale della palestra è in [2026-09-24-gym-workouts-design.md](../../superpowers/specs/2026-09-24-gym-workouts-design.md): sessione live salvata a ogni modifica con endpoint granulari, regole di spunta, riposo, Precedente e fine che questa feature replica nel client. Le feature offline precedenti sono [ipa-apertura-offline](../2026-10-12-ipa-apertura-offline/spec.md), [ipa-precarico-offline](../2026-10-13-ipa-precarico-offline/spec.md) (precarico, puntino, "Non disponibile offline"; il suo R9 vieta al precarico di toccare `["gym","workout","active"]`) e [errore-modelli-offline](../2026-10-14-errore-modelli-offline/spec.md).

Lato API:
- `api/app/models/workout.py`: `Workout`, `WorkoutExercise`, `WorkoutSet`; indice unico parziale `ux_workouts_one_in_progress`; `rest_notified_at` usato dal notifier push.
- `api/app/services/workouts.py`: `start_workout`, endpoint granulari (tutti passano da `_save`), `_renumber`, `complete_set`, `rest`, `finish_workout`, `previous_sets`, `best_sets`, `workout_out` (aggiunge `previous`, `max_set`, `template_diff`, `server_now`).
- `api/app/services/gym_rules.py`: regole pure `normalize_supersets`, `set_problem`, `rest_after_completion`, `template_diff`, `format_set`; testate DB-free in `api/tests/test_gym_rules.py`.
- `api/app/routers/workouts.py`, `api/app/schemas/workout.py` (`WorkoutOut`, `SetValues` con i limiti 0–1000 / 0–36000, `RestSeconds` 0–600, nome 1–100, nota ≤ 500).
- `api/app/services/rest_notifier.py`: push web a fine riposo, con finestra `MAX_LATE` di 60 s su `rest_ends_at`.
- Errori di dominio: `Invalid` → 400, `NotFound` → 404 (`api/app/main.py`).

Lato web (solo IPA, `isNative()` in `web/src/native/platform.ts`):
- `web/src/api/gym.ts`: tipi `Workout`, `useActiveWorkout`, `gymApi`, `useLiveMutation` (coda `live-workout`), `useFinishWorkout`, `useCancelWorkout`, `useHistory`.
- `web/src/pages/gym/WorkoutPage.tsx`, `web/src/components/gym/WorkoutExerciseCard.tsx`, `SetRow.tsx`, `RestTimerBar.tsx`, `ActiveWorkoutBar.tsx`, `ExercisePicker.tsx`; `web/src/pages/gym/GymStartPage.tsx`, `HistoryPage.tsx`, `WorkoutDetailPage.tsx`.
- `web/src/lib/gym.ts` (già contiene `normalizeSupersets` e `formatSet` speculari al server), `web/src/lib/restTimer.ts` (`clockOffsetMs`, `remainingSeconds`).
- `web/src/native/queryPersistence.ts` (file `yfp/query-cache.json`, buster per build, chiave attiva esclusa), `prefetch.ts`, `prefetchScheduler.ts`, `cachePrune.ts`, `connectivity.ts`, `restNotifications.ts`, `NativeBridge.tsx` (oggi programma la notifica dagli aggiornamenti di `["gym","workout","active"]`), `session.ts`; `web/src/components/OfflineIndicator.tsx`, `ModeSwitch.tsx`; logout in `web/src/auth/AuthContext.tsx`, 401 in `web/src/api/client.ts`.

Vincoli: PWA e web restano server-autoritativi e invariati. Il server resta autoritativo al `PUT` (ricalcola e restituisce l'allenamento canonico). Non c'è Postgres locale: i test con DB girano solo sul server remoto con pytest in Docker; in locale girano `cd web && npm test` e i pytest DB-free. Il container dei test monta solo `api/`, quindi le fixture condivise devono stare sotto `api/`.

## Impatto sull'esistente

- Comportamenti che cambiano (solo IPA):
  - la sessione live non mostra più "Allenamento non disponibile offline": ogni azione si applica subito allo stato locale, con o senza rete, e i toast "Non salvato: controlla la connessione" della sessione non compaiono più;
  - "Inizia un allenamento vuoto" e "Inizia allenamento" da un modello in cache funzionano offline;
  - offline il selettore esercizi cerca tra gli esercizi già sul dispositivo;
  - lo Storico mostra in cima gli allenamenti finiti non ancora sincronizzati, con un'etichetta;
  - il segmento "Palestra" mostra un badge con il numero di allenamenti da sincronizzare e il fumetto del puntino offline lo riporta;
  - "Termina" offline apre un riepilogo locale;
  - può comparire un dialogo di scelta in caso di conflitto con la copia del server;
  - la notifica di fine riposo si programma dallo stato locale.
- Comportamenti da preservare:
  - **P1**: web e PWA: sessione live con endpoint granulari, coda `live-workout`, toast d'errore, "Allenamento non disponibile offline" e tutte le altre schermate come oggi.
  - **P2**: risposte degli endpoint esistenti identiche, salvo i campi aggiunti `uuid` e `version`.
  - **P3**: al massimo un allenamento `in_progress` per utente; `POST /workouts` con uno già attivo risponde 400 come oggi.
  - **P4**: regole di Precedente e Max sul server invariate; nell'IPA, dopo un sync riuscito, ogni serie mostra gli stessi Precedente e Max che oggi restituisce il server.
  - **P5**: regole di fine (`incomplete_sets`, `empty_workout`, scarto di serie non completate ed esercizi vuoti) e riepilogo con `template_diff`, "Aggiorna modello" e "Salva come modello"; nell'IPA con rete il riepilogo dopo "Termina" è quello di oggi, letto dal server.
  - **P6**: push web di fine riposo (PWA) come oggi: nessuna push in più per i riposi arrivati con il sync e già scaduti; il notifier non cambia la versione.
  - **P7**: notifica locale di fine riposo dell'IPA: una sola pendente (id fisso), rispetta l'impostazione e il permesso, si cancella a riposo saltato, a fine allenamento, ad annullamento e al logout; il tocco apre `/gym/workout`.
  - **P8**: persistenza della cache delle query: `["gym","workout","active"]` resta esclusa, il buster scarta il file a ogni nuova IPA, logout e 401 cancellano `yfp/query-cache.json`.
  - **P9**: precarico: trigger, throttle, tetti, pulizia a 14 giorni e divieto di toccare `["gym","workout","active"]` (R9 di ipa-precarico-offline) restano.
  - **P10**: Storico e dettaglio degli allenamenti già sul server, eliminazione, "Salva come modello" e "Aggiorna modello" funzionano come oggi (online).
  - **P11**: statistiche palestra, editor modelli, tool MCP (sola lettura) e autenticazione Bearer invariati.
- Compatibilità: retrocompatibile. Il `PUT /api/workouts/{uuid}` e lo snapshot sono endpoint nuovi; `uuid` e `version` sono campi aggiunti alle risposte, ignorati da PWA, web e IPA vecchie, che continuano a usare gli endpoint granulari. La nuova IPA richiede il server aggiornato: va deployato prima il server. Se la nuova IPA trova un server vecchio, il sync fallisce in stato "errore di sincronizzazione" e i dati restano sul telefono.
- Migrazioni:
  - nuova revisione Alembic dopo l'head attuale: `workouts.uuid` (UUID, non nullo, unico), `workouts.version` (intero, non nullo, default 1), `workout_exercises.uuid` e `workout_sets.uuid` (UUID, non nulli, unici). Le righe esistenti ricevono un UUID con `gen_random_uuid()` (Postgres 16) e le nuove righe create dagli endpoint esistenti lo ricevono dal default del DB. Downgrade: rimozione delle colonne;
  - nuovo file locale nell'IPA con proprio numero di schema (versione 1), separato dalla cache delle query.

## Requisiti funzionali

API (server):

- **R1**: Ogni scrittura su un allenamento tramite API REST (endpoint granulari, rinomina, fine, salva come modello, `PUT`) deve incrementare `version` di 1 nella stessa transazione. Il notifier dei riposi (`rest_notified_at`) e le cascate del DB (per esempio `template_id` a null quando si elimina un modello) non la cambiano. `WorkoutOut` espone `uuid` e `version`; ogni esercizio e ogni serie espone il proprio `uuid` accanto all'`id`.
- **R2**: `PUT /api/workouts/{uuid}` (permesso `workouts.use`, autenticazione come gli altri endpoint) riceve l'allenamento intero: `base_version` (intero o null), `name`, `template_id` (o null), `status` (`in_progress` o `finished`), `started_at`, `finished_at`, `rest_ends_at`, `rest_total_s`, ed `exercises` in ordine, ognuno con `uuid`, `exercise_id`, `rest_seconds`, `superset_group`, `note` e `sets` in ordine, ognuna con `uuid`, `weight_kg`, `reps`, `duration_s`, `completed_at`. La versione viaggia nel corpo (`base_version`) e torna nella risposta (`version`). Con uuid sconosciuto e `base_version` null crea l'allenamento (201); con `base_version` uguale alla versione del server lo aggiorna (200). Esercizi e serie sono abbinati per `uuid`: quelli abbinati mantengono l'id del server, quelli nuovi lo ricevono, quelli assenti vengono eliminati. La risposta è il `WorkoutOut` canonico (con `previous` e `max_set` se in corso, `template_diff` se finito) e fa da mappa uuid → id.
- **R3**: Il `PUT` applica le stesse regole degli endpoint granulari: esercizi visibili all'utente (altrimenti 404), `template_id` non posseduto o inesistente salvato come null, posizioni riscritte dall'ordine ricevuto, superserie normalizzate con `normalize_supersets`, limiti di `SetValues`, `RestSeconds`, nome e nota, serie completate valide per `set_problem` (altrimenti 400 con lo stesso messaggio di oggi), e un tetto di dimensione per rifiutare payload abnormi (100 esercizi, 100 serie per esercizio). Con `status = finished` scarta le serie non completate e gli esercizi rimasti vuoti, richiede almeno una serie completata (400 `empty_workout`) e azzera il riposo. Alla creazione da modello imposta `last_used_at` del modello a `started_at`, come `start_workout`.
- **R4**: Il `PUT` risponde 409 con corpo `{"detail": <motivo>, "current": <WorkoutOut o null>}` quando: `base_version` è diversa dalla versione del server (`version_conflict`, `current` è la copia del server); `base_version` non è null ma l'uuid non esiste più (`version_conflict`, `current` null); l'allenamento arriva `in_progress` mentre l'utente ne ha un altro `in_progress` con uuid diverso (`other_active`, `current` è l'altro); l'allenamento è già `finished` sul server e il contenuto ricevuto è diverso (`version_conflict`). Un uuid di un altro utente risponde 404.
- **R5**: Il `PUT` è idempotente: se il contenuto ricevuto, dopo la normalizzazione, coincide con lo stato attuale del server, risponde 200 con lo stato attuale senza incrementare la versione, qualunque sia `base_version`.
- **R6**: Plausibilità degli orari ricevuti, con tolleranza T = 5 minuti rispetto all'ora del server; i valori fuori limite vengono riportati al limite, non rifiutati: `started_at` ≤ ora + T; `finished_at` tra `started_at` e ora + T; ogni `completed_at` tra `started_at` e `finished_at` (se finito) o ora + T; `rest_ends_at` ≤ ora + 600 s + T; `rest_ends_at` e `rest_total_s` entrambi presenti o entrambi null, `rest_total_s` tra 1 e 600. Se `rest_ends_at` è già passato al momento del `PUT`, `rest_notified_at` viene impostato a `rest_ends_at`, così il notifier non invia una push tardiva.
- **R7**: `GET /api/workouts/offline-snapshot` (permesso `workouts.use`) restituisce `server_now` e, per ogni esercizio presente nei modelli dell'utente, negli allenamenti finiti negli ultimi 90 giorni o nell'allenamento attivo: l'esercizio (`ExerciseOut`), il `rest_seconds` dell'ultima esecuzione finita (o null), la lista `previous` e la lista `max` per posizione, calcolate con `previous_sets` e `best_sets` senza regole nuove. La rotta è dichiarata prima di `/{workout_id}`.

Stato locale e regole nel client (solo IPA):

- **R8**: L'IPA conserva lo stato della palestra in un file JSON in `Directory.Library` tramite `@capacitor/filesystem`, separato da `yfp/query-cache.json`: id dell'utente, numero di schema, allenamento attivo (o nessuno), allenamenti finiti non ancora sincronizzati, per ognuno `base_version`, uuid, stato di sync (in attesa, conflitto, errore), ultima risposta del server e scarto d'orologio. La scrittura è atomica (file temporaneo e sostituzione), avviene entro circa 1 s da ogni modifica e subito quando l'app va in background. Il file non contiene il token, non dipende dal buster della cache e sopravvive agli aggiornamenti dell'IPA. Un file illeggibile non blocca l'avvio: viene messo da parte con un nuovo nome e l'app parte senza stato locale.
- **R9**: Nell'IPA tutte le azioni della sessione live, con o senza rete, si applicano subito allo stato locale senza attendere il server: rinomina, aggiungi esercizi, sostituisci esercizio (con cambio di tracking: serie non completate e campi non usati azzerati, come `patch_exercise`), riposo dell'esercizio, nota, sposta su/giù, collega e scollega superserie, rimuovi esercizio, aggiungi serie (copia dell'ultima, oppure la prima di Precedente, oppure vuota), modifica valori, elimina serie, completa (con valori, validazione `set_problem`, avvio del riposo con `rest_after_completion`) e annulla completamento (senza toccare il timer), timer manuale, ±15 s e Salta (con le regole di `rest` sul server). Una validazione fallita mostra lo stesso messaggio di oggi (`liveErrorMessage`) e non cambia lo stato.
- **R10**: Esercizi e serie creati nel client ricevono un UUID v4 generato dal client; l'allenamento creato nel client riceve un UUID v4 che resta il suo identificativo verso `PUT /workouts/{uuid}`.
- **R11**: Gli orari scritti dal client (`started_at`, `completed_at`, `rest_ends_at`, `finished_at`) sono stimati sull'orologio del server con l'ultimo scarto noto (`server_now` meno ora del telefono alla ricezione di una risposta), salvato nello stato locale; senza nessuna risposta lo scarto è zero. Conto alla rovescia, beep e notifica usano lo stesso scarto, anche dopo un riavvio dell'app.
- **R12**: Avvio offline: "Inizia un allenamento vuoto" crea un allenamento con nome "Allenamento GG/MM/AAAA" (data locale); "Inizia allenamento" da un modello copia esercizi, serie, riposi, superserie e note dal dettaglio `["gym","template",id]` in cache. Se il dettaglio del modello non è in cache e manca la rete, il foglio anteprima mostra "Non disponibile offline" e non avvia. Con un allenamento locale attivo, l'avvio chiede di riprenderlo come oggi. Un esercizio aggiunto riceve serie e riposo da Precedente come `add_exercise` (tutte le serie di Precedente, riposo dell'ultima volta, altrimenti una serie vuota e 90 s).
- **R13**: Precedente e Max di una serie: se l'ultima risposta del server per quell'allenamento contiene la serie (stesso uuid), si usano i suoi `previous` e `max_set`; altrimenti si usano le liste dello snapshot per posizione. Un esercizio fuori dallo snapshot mostra "—" e nessun max.
- **R14**: Offline il selettore esercizi cerca, filtrando nel client per nome, attrezzo e muscolo, tra gli esercizi già sul dispositivo: la pagina del catalogo in cache (`["gym","exercises",EMPTY_FILTERS]`), gli esercizi dello snapshot e quelli dei modelli in cache, senza duplicati. "+ Nuovo" offline mostra "Non disponibile offline". Con rete il selettore funziona come oggi.

Sync:

- **R15**: Il sync parte: dopo ogni modifica locale, con coalescing (circa 1 s di quiete); al ritorno della rete; al ritorno in primo piano; all'apertura dell'app con un token. Non dipende dal throttle del precarico. Al più un `PUT` in volo per allenamento; prima gli allenamenti finiti, in ordine di fine, poi quello attivo. Usa il client esistente (Bearer, `X-Requested-With`), quindi un errore di rete segna lo stato offline come oggi e il tentativo successivo segue il ritorno della rete.
- **R16**: Esito del `PUT`: con 200/201, se dal momento dell'invio non ci sono state modifiche locali, lo stato locale diventa la copia canonica del server (con nuova `base_version`, id, `previous`, `max_set`); se ce ne sono state, lo stato locale le conserva, prende la nuova `base_version` e la risposta, e parte un nuovo `PUT`. Un allenamento finito sincronizzato esce dallo stato locale e la sua risposta va in `["gym","workout",id]`; si invalidano `["gym","history"]`, `["gym","stats"]`, `["gym","templates"]` e lo snapshot. Con 409 l'allenamento passa in stato "conflitto" (R18). Con 401 vale il comportamento di oggi (token rimosso, login) e lo stato locale resta (R21). Con altri 4xx l'allenamento passa in "errore di sincronizzazione", i dati restano e il tentativo si ripete al successivo ritorno in primo piano o apertura. Con 5xx si ritenta ai trigger di R15.
- **R17**: All'apertura dell'app e al ritorno in primo piano, con rete, l'IPA legge `GET /workouts/active` e: se non ha un allenamento attivo locale, adotta quello del server (con uuid, versione e scarto d'orologio); se ha lo stesso uuid senza modifiche in attesa e il server ha una versione più alta, adotta la copia del server; se ha modifiche in attesa, non adotta e lascia decidere al `PUT` (eventuale 409); se ha un allenamento locale con uuid diverso, il `PUT` successivo produce il 409 `other_active`. Se il server non ha un allenamento attivo e quello locale era già sincronizzato senza modifiche in attesa, il locale viene rimosso (finito o annullato altrove).
- **R18**: In stato "conflitto" l'IPA mostra, all'apertura di Palestra o della sessione, un dialogo con il riepilogo delle due copie (nome, inizio, numero di esercizi, serie completate sul totale, stato) e due scelte: "Tieni la copia del telefono" e "Tieni la copia del server". Copia del telefono: con `version_conflict` si reinvia con `base_version` uguale alla versione di `current` (o null se `current` è null); con `other_active` si annulla prima l'altro allenamento con `DELETE /workouts/{id}` e poi si reinvia. Copia del server: lo stato locale prende `current` (se in corso diventa l'attivo locale, se finito o null la copia locale viene eliminata). Finché la scelta non è fatta, il sync di quell'allenamento è fermo e le modifiche locali restano possibili.

Fine, annulla, Storico e indicatori (solo IPA):

- **R19**: "Termina" applica in locale le regole di oggi: senza serie completate avvisa e non chiude; con serie non completate chiede conferma e le scarta, eliminando anche gli esercizi vuoti; azzera il riposo. Poi avvia il sync: se il `PUT` riesce entro circa 5 s, apre `/gym/history/{id}?summary=1` dal server come oggi; altrimenti apre un riepilogo locale con nome, data, durata, esercizi e serie, la lista delle modifiche rispetto al modello calcolata nel client con la stessa regola di `template_diff` (se il modello è in cache) e la riga "Potrai aggiornare il modello dopo la sincronizzazione" al posto dei pulsanti. Se il sync riesce mentre il riepilogo locale è aperto, il riepilogo passa ai dati del server e abilita "Aggiorna modello" e "Salva come modello". Se il riepilogo locale viene chiuso prima del sync, la proposta "Aggiorna modello" viene riproposta una sola volta: quando, dopo il sync, si apre il dettaglio di quell'allenamento dallo Storico e `template_diff` non è vuoto.
- **R20**: "Annulla allenamento": un allenamento mai sincronizzato viene eliminato solo in locale, anche offline; uno già sincronizzato, con rete, si elimina con `DELETE /workouts/{id}` come oggi e poi in locale. Offline, uno già sincronizzato sparisce subito dal telefono e viene marcato come da eliminare: al ritorno della rete parte `DELETE /workouts/{id}` solo se la versione del server è ancora quella nota, altrimenti l'allenamento passa in stato "conflitto" (R18) e il dialogo mostra le due copie.
- **R21**: Logout esplicito con allenamenti locali non sincronizzati: un dialogo avvisa "Ci sono N allenamenti non sincronizzati: uscendo andranno persi" e, se confermato, il file locale viene cancellato insieme alla cache. Un 401 di sessione non cancella il file: dopo il login dello stesso utente il sync riprende. Il login di un utente diverso cancella il file dell'utente precedente senza inviarlo.
- **R22**: Lo Storico mostra in cima, sopra i gruppi per mese, gli allenamenti finiti locali non ancora sincronizzati, con la stessa card di oggi e un'etichetta "Da sincronizzare" (oppure "Conflitto" o "Errore di sincronizzazione"). Il tocco apre il dettaglio letto dallo stato locale, senza il menu Elimina/Salva come modello e senza scorrimento per eliminare. Un allenamento non compare mai due volte: appena il server lo conferma, la voce locale sparisce.
- **R23**: Con N > 0 allenamenti locali finiti non sincronizzati, in conflitto o in errore, il segmento "Palestra" di `ModeSwitch` mostra un badge con N, con nome accessibile "N allenamenti da sincronizzare". Il fumetto del puntino offline aggiunge " · N da sincronizzare" al testo di oggi. `ActiveWorkoutBar`, "Riprendi allenamento" e la sessione leggono l'allenamento attivo dallo stato locale.
- **R24**: Nell'IPA la notifica locale di fine riposo si programma e si cancella dallo stato locale (ogni modifica di `rest_ends_at`, fine, annullamento) usando lo scarto di R11, e all'avvio dell'app si ricostruisce dallo stato salvato: riposo ancora in corso → riprogrammata, scaduto o assente → cancellata.

Precarico, parità e documentazione:

- **R25**: Il giro di precarico, per gli utenti con `workouts.use`, scarica lo snapshot nella chiave `["gym","offline-snapshot"]`, che viene persistita nella cache delle query, riscritta a ogni giro completato e cancellata con il file della cache a logout e 401. Il precarico non legge né scrive lo stato locale della palestra.
- **R26**: Le regole replicate nel client vivono in un modulo puro, senza React né plugin, e sono verificate con fixture JSON condivise in `api/tests/fixtures/` lette sia da pytest sia da Vitest: `normalize_supersets`, `set_problem`, `rest_after_completion`, `template_diff` (stesse stringhe italiane), `format_set`, rinumerazione, regole di fine (`empty_workout`, `incomplete_sets`, scarto), prefill di aggiungi serie e aggiungi esercizio, cambio di tracking, azioni sul riposo, e la normalizzazione canonica del `PUT`. Per poterla testare senza DB, la normalizzazione canonica del server è una funzione pura in `api/app/services/gym_rules.py`.
- **R27**: Il `README.md`, sezione "iOS app (IPA)", sostituisce il punto "Offline, read-only" descrivendo: allenamento offline completo nell'IPA, sync automatico, Storico "Da sincronizzare", badge, scelta in caso di conflitto, dati persi solo con logout confermato o con la disinstallazione.

## Requisiti non funzionali

- Reattività: nell'IPA ogni azione della sessione aggiorna la schermata senza attendere la rete; la scrittura del file non blocca l'interfaccia.
- Durabilità: una modifica fatta più di circa 1 s prima della chiusura forzata dell'app, o prima del passaggio in background, si ritrova alla riapertura.
- Sicurezza: il file locale non contiene il token; il `PUT` e lo snapshot rispettano permesso, isolamento per utente (404 per uuid altrui) e `X-Requested-With`, come gli altri endpoint (ADR 0003).
- Peso: lo snapshot per un utente tipico (decine di esercizi) resta nell'ordine delle decine di KB; il precarico continua a riscrivere il file della cache una o due volte per giro.
- Compatibilità: nessun cambiamento visibile su web e PWA; endpoint esistenti retrocompatibili.

## Criteri di accettazione

API (pytest; i test con DB girano sul server remoto con DB isolato `yfp_test`, come da prassi del progetto):

- **C1** (R1): Dato un allenamento in corso con `version = 3`, quando si chiama un qualunque endpoint granulare (per esempio `POST .../sets/{id}/complete`), allora la risposta ha `version = 4` e `uuid` invariato, e ogni esercizio e serie ha un `uuid`. [pytest remoto]
- **C2** (R1, P6): Dato un allenamento con riposo scaduto, quando `notify_due_rests` lo reclama, allora `version` non cambia. [pytest remoto]
- **C3** (R2): Dato un uuid nuovo, quando si invia `PUT /api/workouts/{uuid}` con `base_version: null` e un esercizio con due serie, allora la risposta è 201, `version = 1`, e l'allenamento compare in `GET /workouts/active` con gli stessi uuid; un secondo `PUT` con `base_version: 1` che toglie una serie e ne aggiunge un'altra risponde 200 con `version = 2`, la serie conservata mantiene il suo `id` e quella tolta non esiste più. [pytest remoto]
- **C4** (R3): Dato un `PUT` con una serie completata di un esercizio `weight_reps` senza `reps`, allora la risposta è 400 con `detail` "weight and reps are required" e nulla cambia; con un `exercise_id` custom di un altro utente la risposta è 404; con un `template_id` inesistente l'allenamento viene salvato con `template_id` null. [pytest remoto]
- **C5** (R3): Dato un `PUT` con `status: finished`, una serie non completata e un esercizio con sole serie non completate, allora la risposta ha `finished_at`, nessun riposo, solo le serie completate, nessun esercizio vuoto e `template_diff` calcolato come `finish_workout`; senza serie completate la risposta è 400 `empty_workout`. [pytest remoto]
- **C6** (R4): Dato un allenamento alla versione 5, quando arriva un `PUT` con `base_version: 4` e contenuto diverso, allora la risposta è 409 con `detail: "version_conflict"` e `current.version = 5`; con un uuid inesistente e `base_version: 2` la risposta è 409 con `current: null`; con un secondo allenamento `in_progress` di uuid diverso la risposta è 409 `other_active` con `current` uguale all'attivo. [pytest remoto]
- **C7** (R4): Dato un uuid di un allenamento di un altro utente, quando si invia il `PUT`, allora la risposta è 404. [pytest remoto]
- **C8** (R5): Dato un `PUT` riuscito che ha portato la versione a 2, quando lo stesso corpo viene reinviato con `base_version: 1`, allora la risposta è 200 con `version = 2`. [pytest remoto]
- **C9** (R6): Dato un `PUT` con `started_at` un'ora nel futuro e un `completed_at` precedente a `started_at`, allora nella risposta `started_at` non supera l'ora del server più 5 minuti e `completed_at` è uguale a `started_at`; dato un `PUT` con `rest_ends_at` già passato da 10 s, allora `rest_notified_at = rest_ends_at` e `notify_due_rests` non invia push. [pytest remoto]
- **C10** (R7): Dato un utente con un modello che contiene Squat e un allenamento finito con Panca 2×(80 kg × 8), quando chiama `GET /api/workouts/offline-snapshot`, allora la risposta contiene Squat (senza `previous`) e Panca con `previous` e `max` uguali a quelli che `GET /workouts/active` mostrerebbe per Panca in un nuovo allenamento. [pytest remoto]
- **C11** (R1, migrazione): Eseguendo `alembic upgrade head` sul DB isolato remoto e poi `alembic downgrade -1` e di nuovo `upgrade head`, i comandi terminano senza errori e gli allenamenti esistenti hanno `uuid` distinti e `version = 1`. [remoto]
- **C12** (R26): Eseguendo `cd api && pytest tests/test_gym_rules.py tests/test_gym_parity.py` (DB-free, anche in locale), tutti i casi delle fixture condivise passano.

Client (Vitest, `cd web && npm test`, piattaforma nativa simulata dove indicato):

- **C13** (R26): Eseguendo `cd web && npm test`, i test di parità leggono le stesse fixture di `api/tests/fixtures/` e passano per ogni caso; aggiungere un caso alla fixture lo fa girare in entrambe le suite.
- **C14** (R8): Dato lo stato locale con un allenamento attivo, quando si modifica una serie e l'app va in background, allora il file in `Directory.Library` viene scritto subito (file temporaneo poi sostituito) e non contiene il token; dopo un ripristino simulato lo stato è identico.
- **C15** (R8): Dato un file locale con JSON non valido, quando l'app si avvia, allora parte senza errori e senza stato locale, e il file viene rinominato invece che cancellato.
- **C16** (R8, P8): Dato un cambio del buster della cache (nuova build), quando l'app si avvia, allora `yfp/query-cache.json` viene scartato e il file locale della palestra resta e viene caricato.
- **C17** (R9, R12): Dato l'IPA offline con il dettaglio di un modello in cache, quando si tocca "Inizia allenamento", si compilano e si completano tutte le serie, allora ogni ✓ aggiorna subito la riga, parte il timer con il riposo dell'esercizio, nessuna richiesta di rete viene attesa e nessun toast d'errore compare.
- **C18** (R9): Data una superserie A+B offline, quando si completa la serie 1 di A, allora non parte il timer; quando si completa la serie 1 di B, parte il timer con il riposo di B.
- **C19** (R9): Dato un esercizio `weight_reps` offline, quando si tocca ✓ su una serie senza kg, allora compare "Inserisci kg e ripetizioni" e la serie resta non completata.
- **C20** (R12): Dato l'IPA offline senza il dettaglio del modello in cache, quando si apre l'anteprima e si tocca "Inizia allenamento", allora compare "Non disponibile offline" e nessun allenamento viene creato.
- **C21** (R13): Dato uno snapshot con Panca `previous` [80×8, 80×6] e `max` [85×8], quando si aggiunge Panca offline, allora compaiono due serie precompilate 80×8 e 80×6, Precedente "80 kg × 8" e "80 kg × 6", e "max 85 kg × 8" solo sulla prima; un esercizio fuori dallo snapshot mostra "—".
- **C22** (R14): Dato l'IPA offline, quando nel selettore si cerca "squat", allora l'elenco mostra gli esercizi locali che contengono "squat" (catalogo in cache, snapshot, modelli) senza duplicati, e "+ Nuovo" mostra "Non disponibile offline".
- **C23** (R11): Dato uno scarto d'orologio salvato di +60 s e un riposo di 90 s avviato, quando l'app si riavvia dopo 30 s, allora il conto alla rovescia mostra circa 1:00 e la notifica è programmata all'ora del telefono corrispondente a `rest_ends_at` meno lo scarto.
- **C24** (R15, R16): Dato un allenamento locale con modifiche e la rete assente, quando la rete torna, allora parte un solo `PUT` con l'ultimo stato; con 200 e nessuna modifica nel frattempo lo stato locale prende la risposta del server; con una modifica arrivata durante il `PUT` la modifica resta e parte un secondo `PUT` con la nuova `base_version`.
- **C25** (R15): Date cinque modifiche in 500 ms, quando il coalescing scade, allora parte un solo `PUT`.
- **C26** (R16): Dato un allenamento finito offline, quando il sync riesce, allora la voce locale sparisce dallo Storico, `["gym","history"]`, `["gym","stats"]`, `["gym","templates"]` e lo snapshot vengono invalidati e `["gym","workout",id]` contiene la risposta.
- **C27** (R16): Dato un `PUT` che risponde 400, allora l'allenamento resta sul telefono con l'etichetta "Errore di sincronizzazione" e il badge lo conta; al successivo ritorno in primo piano il `PUT` viene ritentato.
- **C28** (R17): Dato un allenamento avviato sul web e nessuno stato locale, quando l'IPA si apre con rete, allora la sessione mostra quell'allenamento e una modifica fatta nell'IPA arriva al server con `PUT` su quel `uuid` e `base_version` uguale alla versione letta.
- **C29** (R4, R18): Dato un 409 `version_conflict`, quando si apre Palestra, allora compare il dialogo con il riepilogo delle due copie; scegliendo "Tieni la copia del telefono" parte un `PUT` con `base_version` uguale a `current.version`; scegliendo "Tieni la copia del server" lo stato locale diventa `current`.
- **C30** (R18): Dato un 409 `other_active`, quando si sceglie "Tieni la copia del telefono", allora partono nell'ordine `DELETE /workouts/{id dell'altro}` e il `PUT` dell'allenamento locale.
- **C31** (R19): Dato l'IPA offline con serie non completate, quando si tocca "Termina" e si conferma, allora si apre il riepilogo locale con le sole serie completate, le modifiche rispetto al modello e "Potrai aggiornare il modello dopo la sincronizzazione"; quando il sync riesce con il riepilogo aperto, compare "Aggiorna modello".
- **C32** (R19, P5): Dato l'IPA con rete, quando si tocca "Termina", allora entro circa 5 s si apre `/gym/history/{id}?summary=1` con il `template_diff` del server, come oggi.
- **C33** (R20): Dato un allenamento avviato offline e mai sincronizzato, quando si tocca "Annulla allenamento" offline e si conferma, allora lo stato locale non ha più l'allenamento e nessuna richiesta parte al ritorno della rete.
- **C34** (R21): Dato un allenamento finito non sincronizzato, quando si fa logout, allora compare l'avviso con N = 1; annullando non succede nulla; confermando il file locale viene cancellato. Dato invece un 401 di sessione, il file resta e dopo il login dello stesso utente parte il `PUT`.
- **C35** (R22): Dato un allenamento finito non sincronizzato, quando si apre lo Storico offline, allora compare in cima con l'etichetta "Da sincronizzare", il tocco apre il dettaglio locale senza menu Elimina e la card non si può scorrere per eliminarla.
- **C36** (R23): Dati due allenamenti finiti non sincronizzati, allora il segmento "Palestra" mostra "2" con nome accessibile "2 allenamenti da sincronizzare" e, offline, il fumetto del puntino termina con "· 2 da sincronizzare"; con N = 0 il badge non c'è.
- **C37** (R24): Dato un riposo in corso nello stato locale, quando l'app si riavvia, allora la notifica locale viene riprogrammata con id 4101; dato un riposo scaduto, viene cancellata; con le notifiche disattivate in Impostazioni nessuna notifica viene programmata.
- **C38** (R25, P9): Dato un giro di precarico completato per un utente con `workouts.use`, allora `["gym","offline-snapshot"]` è in cache e nel file della cache, il giro non legge né scrive `["gym","workout","active"]` né il file locale della palestra; per un utente senza `workouts.use` lo snapshot non viene chiesto.
- **C39** (R27): Il `README.md`, sezione "iOS app (IPA)", non contiene più "Offline, read-only" e descrive sync, Storico "Da sincronizzare", badge e conflitto.
- **C53** (R20): Dato un allenamento già sincronizzato, quando si tocca "Annulla allenamento" offline e si conferma, allora sparisce subito dal telefono; al ritorno della rete parte `DELETE /workouts/{id}` se la versione del server è quella nota, altrimenti l'allenamento passa in "conflitto" e si apre il dialogo di R18 senza cancellare nulla sul server.
- **C54** (R19): Dato un allenamento finito offline con `template_diff` non vuoto e il riepilogo locale chiuso prima del sync, quando dopo il sync si apre il suo dettaglio dallo Storico, allora compare la proposta "Aggiorna modello" una volta sola; alla riapertura successiva non compare più.

Preservare:

- **C40** (preservare P1): Dato il browser (non nativo), quando si apre `/gym/workout` e si completa una serie, allora parte `POST /workouts/{id}/sets/{id}/complete` come oggi, offline compare il toast "Non salvato: controlla la connessione", e i test esistenti di `WorkoutPage.test.tsx` e del caso web di `WorkoutPage.offline.test.tsx` passano invariati.
- **C41** (preservare P2): Dato un allenamento esistente, quando si chiamano gli endpoint esistenti, allora le risposte contengono tutti i campi di oggi con gli stessi valori, più `uuid` e `version`. [pytest remoto, test esistenti di `test_gym_routers.py` invariati]
- **C42** (preservare P3): Dato un allenamento in corso, quando si chiama `POST /workouts`, allora la risposta è 400 "a workout is already in progress" come oggi. [pytest remoto]
- **C43** (preservare P4): Dato un allenamento creato con `PUT` con gli stessi esercizi di uno avviato con `POST /workouts`, allora `previous` e `max_set` per posizione sono identici nelle due risposte. [pytest remoto]
- **C44** (preservare P5): Dato il browser, quando si termina un allenamento con serie non completate, allora il dialogo, `POST .../finish` con `discard_incomplete` e il riepilogo con "Aggiorna modello" funzionano come oggi.
- **C45** (preservare P6): Dato un riposo avviato con `POST .../rest` dal web, quando scade, allora il notifier invia una sola push come oggi (`test_rest_notifier*.py` invariati). [pytest remoto]
- **C46** (preservare P7): Dato un riposo in corso nell'IPA, quando si tocca "Salta", si termina, si annulla o si fa logout, allora la notifica 4101 viene cancellata; il tocco sulla notifica apre `/gym/workout`.
- **C47** (preservare P8): Eseguendo i test esistenti di `queryPersistence*.test.ts`, passano invariati: `["gym","workout","active"]` resta esclusa e logout e 401 cancellano `yfp/query-cache.json`.
- **C48** (preservare P9): Eseguendo i test esistenti di `prefetch*.test.ts`, `prefetchScheduler.test.ts` e `cachePrune.test.ts`, passano con la sola aggiunta dello snapshot ai compiti palestra.
- **C49** (preservare P10): Dato un allenamento già sul server, quando lo si apre dallo Storico con rete, allora Elimina e "Salva come modello" funzionano come oggi.
- **C50** (preservare P11): Eseguendo i test esistenti delle statistiche palestra, dell'editor modelli e dei tool MCP (`test_gym_stats.py`, `test_mcp_tools_workouts.py`, `TemplateEditorPage.test.tsx`, `GymStatsPage.test.tsx`), passano invariati.
- **C51** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano, anche quelli esistenti; `cd web && npm run build` termina senza errori.
- **C52** (non regressione): Eseguendo la suite pytest completa sul server remoto con DB isolato, i fallimenti sono gli stessi del commit base (confronto delle righe FAILED).

## Fuori scope

- Diario cibo offline e cache di `foods/search`, `foods/recent`, `foods/barcode` (feature successiva).
- "Salva come modello", "Aggiorna modello", modifica dei modelli ed eliminazione dallo Storico offline: restano online.
- Creazione di esercizi personalizzati offline e catalogo completo offline oltre la pagina in cache, lo snapshot e i modelli.
- Precedente e Max che tengono conto di allenamenti finiti offline e non ancora sincronizzati: lo snapshot si aggiorna dopo il sync.
- Statistiche palestra e dieta aggiornate offline.
- Uso simultaneo dello stesso allenamento da due dispositivi oltre al 409 con scelta.
- Modifica degli allenamenti finiti.
- Cambio delle regole di Precedente, Max e `template_diff` sul server; HealthKit e Live Activity; PWA offline in scrittura.

## Rischi

- Divergenza tra le regole del client e del server: fixture condivise (R26, C12, C13) e server autoritativo al `PUT` (R16).
- Perdita dello stato locale se SideStore reinstalla l'app cancellando `Directory.Library`: sync immediato con rete; da verificare sull'iPhone con un aggiornamento via SideStore prima del rilascio.
- Orologio del telefono sbagliato senza nessuna risposta del server in quella sessione: lo scarto vale zero e gli orari dipendono dal telefono; i limiti di R6 evitano valori assurdi.
- Idempotenza e limiti di R6: se il server ha riportato un orario al limite, un reinvio identico non coincide più e, con `base_version` vecchia, produce un 409 non necessario; caso raro, risolto dal dialogo.
- I componenti della sessione oggi usano id numerici del server: passare a uuid per l'IPA tocca `SetRow`, `WorkoutExerciseCard` e `WorkoutPage`, che il web condivide. Mitigazione: i test esistenti del web invariati (C40, C44, C51).
- Dialogo del 409 poco chiaro: riepilogo minimo (serie completate e orari) e test dedicati (C29, C30).
- Precondizione: la verifica T4 su iPhone del fix [errore-modelli-offline](../2026-10-14-errore-modelli-offline/spec.md) va fatta prima di costruire su queste schermate.

## Domande aperte

- Nessuna. Decisioni dell'utente del 2026-10-14: annullare offline un allenamento già sincronizzato è permesso (R20, C53); "Aggiorna modello" viene riproposta una sola volta dopo il sync (R19, C54).
