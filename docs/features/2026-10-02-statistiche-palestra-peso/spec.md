# Spec: Statistiche palestra e peso giornaliero

- Data: 2026-10-02
- Tipo: feature
- Stato: completato
- Brainstorm: [brainstorm.md](brainstorm.md)

## Obiettivo

In Statistiche Palestra l'utente vede quanti allenamenti ha finito (con un badge ogni 10), il riepilogo e la frequenza del periodo, la progressione e i record di ogni esercizio; dalla lista Storico cancella un allenamento con uno swipe. In entrambe le sezioni registra il peso del giorno da un tasto nell'header, ne vede andamento e media mobile in Statistiche Dieta, e Claude legge via MCP medie e progressioni già calcolate dal server (approccio A, [ADR 0002](../../decisions/0002-statistiche-lato-server-condivise-web-mcp.md)).

## Contesto tecnico

Decisioni precedenti che questa feature cambia:

- La spec delle statistiche ([2026-09-25-stats-design.md](../../superpowers/specs/2026-09-25-stats-design.md)) metteva `StreakCard` in cima a entrambe le pagine Statistiche e, nella "Modifica 2026-09-25: badge", legava anche i badge palestra alla serie (1 ogni 5 giorni). Qui, solo per la Palestra, la card della serie è sostituita dalla card "N allenamenti" e i badge palestra seguono gli allenamenti finiti (1 ogni 10). Per la Dieta restano valide tutte le decisioni di quella spec, compresi serie, badge e calcolo nel web (`web/src/lib/stats.ts`).
- La spec della palestra ([2026-09-24-gym-workouts-design.md](../../superpowers/specs/2026-09-24-gym-workouts-design.md)) metteva fuori scope "Statistiche, grafici, record personali, conteggi, volume totale". Questa feature li introduce. Restano valide le regole su tracking (`weight_reps`, `reps` con zavorra opzionale, `duration`), sul fatto che a fine allenamento le serie non spuntate vengono eliminate, e sugli esercizi custom archiviati (`archived_at`) che restano visibili nello storico.
- La spec MCP ([2026-09-23-mcp-server-design.md](../../superpowers/specs/2026-09-23-mcp-server-design.md)) resta valida: tool solo sull'utente del token, nomi e argomenti in inglese, date ISO con default "oggi" in `APP_TIMEZONE`, entità altrui trattate come "not found", servizi condivisi tra REST e MCP. Si aggiungono tre tool di sola lettura.
- Resta valida la correzione dell'header della sessione live agganciato al visual viewport ([2026-09-30-timer-riposo-scompare-scroll](../2026-09-30-timer-riposo-scompare-scroll/spec.md)): la pagina `/gym/workout` non usa `ModeSwitch` e non è toccata.

Parti coinvolte:

- **Statistiche palestra.** `web/src/pages/gym/GymStatsPage.tsx` oggi mostra `ModeSwitch`, `StreakCard mode="gym"` e il testo "Statistiche palestra in arrivo". Route protetta da `PermissionGuard permission="workouts.use"` in `web/src/App.tsx`.
- **Serie e badge.** `web/src/components/StreakCard.tsx` (usa `useStreak`, rende `BadgeGrid`), `web/src/components/BadgeGrid.tsx` (testi "Prossimo badge tra N giorni", "Primo badge a 5 giorni di fila", etichetta "N gg" sui badge bloccati), `web/src/lib/badges.ts` (`BADGE_COUNT = 30`, `DAYS_PER_BADGE = 5`, `badgeProgress`), immagini `badgeIcon(mode, n)` in `web/src/lib/art.ts`. API serie: `api/app/routers/stats.py`, `api/app/services/activity.py` (`local_today()` con `settings.app_timezone`), tracker `web/src/components/ActivityTracker.tsx`.
- **Header.** `web/src/components/ModeSwitch.tsx` (riga `relative ... justify-center px-14`, selettore Dieta|Palestra solo con `workouts.use`, sempre `SettingsButton`; non renderizzato su `/settings` senza permesso palestra) e `web/src/components/SettingsButton.tsx` (`absolute right-2`, 44px, nascosto su `/settings`). `ModeSwitch` è usato da `DayPage`, `WeekPage`, `DietStatsPage`, `HistoryPage`, `GymStartPage`, `ExercisesPage`, `GymStatsPage`, `SettingsPage`, `AccountPage`. Sezione corrente da `web/src/lib/appMode.ts` (`modeFromPath`, `currentMode`). Icone disponibili in `art.ts` (`DietIcon`, `GymIcon`): non esiste un'icona bilancia.
- **Statistiche dieta.** `web/src/pages/DietStatsPage.tsx` (StreakCard, GoalForm, `PeriodPicker`, grafici in `web/src/components/stats/`, periodo nel query string), regole in `web/src/lib/stats.ts` (`PRESETS`, `MAX_RANGE_DAYS = 366`, `validateCustomPeriod`).
- **Storico.** `web/src/pages/gym/HistoryPage.tsx` (card `Link` verso `/gym/history/:id`, raggruppate per mese, "Carica altri"), `web/src/pages/gym/WorkoutDetailPage.tsx` (menu `ActionMenu` con "Elimina" e `window.confirm("Eliminare questo allenamento dallo storico?")`), hook `useHistory` e `useDeleteWorkout` in `web/src/api/gym.ts` (invalida `gymKeys.history`).
- **API palestra.** `api/app/services/workouts.py` (`load_workout`, `delete_workout`, `list_history` con `ensure_permission(user, Permission.workouts)`), `api/app/routers/workouts.py` (`DELETE /api/workouts/{id}` → 204), modelli `api/app/models/workout.py` e `api/app/models/exercise.py` (`Tracking`), regole pure in `api/app/services/gym_rules.py`.
- **MCP.** `api/app/mcp/tools/workouts.py` (`register_workout_tools`, `tool_scope`), `api/app/mcp/server.py` (`INSTRUCTIONS`, registrazione tool), permessi in `api/app/permissions.py`.
- **Migrazioni.** `api/alembic/versions/`, head attuale `e3f9b2a7c514_push_subscriptions.py`.

Vincoli: FastAPI + SQLAlchemy async + Alembic + Postgres; web React + TanStack Query + Tailwind; grafici SVG fatti a mano senza nuove dipendenze. Nessun Postgres locale: i test DB girano solo con pytest sul deploy remoto (docker compose). Il "giorno" del peso e degli allenamenti segue `settings.app_timezone` (Europe/Rome). Multi-utente: ogni lettura e scrittura è filtrata per l'utente autenticato. Uso principale da iPhone come PWA.

### Definizioni delle metriche

Valgono per REST e MCP, calcolate una sola volta nei servizi dell'API.

- **Allenamento contato**: allenamento con stato `finished` dell'utente. Gli allenamenti in corso non contano mai. Il giorno di un allenamento è la data locale (`app_timezone`) di `started_at`, la stessa mostrata nella card dello Storico.
- **Serie contata**: serie con `completed_at` valorizzato di un allenamento contato. Dopo la fine dell'allenamento sono tutte le sue serie.
- **Volume**: somma di `weight_kg × reps` sulle serie contate che hanno sia peso sia reps (comprese le serie `reps` con zavorra). Le serie senza peso o a durata contribuiscono 0.
- **Durata media**: media di `finished_at − started_at` degli allenamenti contati nel periodo, in minuti interi. Senza allenamenti è nulla.
- **1RM stimato** (Epley): per una serie con `weight_kg > 0` e `reps > 0`, `weight_kg × (1 + reps/30)`; con `reps = 1` vale `weight_kg`. Arrotondato a 1 decimale. Le altre serie non hanno 1RM.
- **Metriche per sessione di un esercizio**, in base al `tracking` dell'esercizio (una sessione è un allenamento contato che contiene l'esercizio; più occorrenze dello stesso esercizio nello stesso allenamento si sommano):
  - `weight_reps`: carico massimo, 1RM stimato massimo, volume;
  - `reps`: reps massime in una serie, reps totali; se c'è zavorra, anche carico massimo e volume;
  - `duration`: durata massima di una serie, durata totale.
- **Record personali** (su tutto lo storico, non sul periodo), ciascuno con la data della sessione in cui è stato ottenuto (la prima, a parità di valore):
  - `weight_reps`: peso massimo, 1RM stimato massimo, reps massime in una serie;
  - `reps`: reps massime in una serie (più peso massimo se c'è zavorra);
  - `duration`: durata massima di una serie.
- **Frequenza settimanale**: per ogni settimana ISO (lunedì–domenica) che interseca il periodo, numero di allenamenti contati del periodo; le settimane senza allenamenti valgono 0.
- **Media mobile 7 giorni del peso**: per il giorno D, media delle pesate presenti da D−6 a D inclusi, anche se D−6 cade prima dell'inizio del periodo richiesto; nulla se in quei 7 giorni non c'è nessuna pesata. Arrotondata a 1 decimale.
- **Media settimanale del peso**: per ogni settimana ISO che interseca il periodo, media delle pesate di tutta la settimana (anche giorni fuori dal periodo), con il numero di pesate e la variazione rispetto alla media della settimana ISO precedente; variazione nulla se una delle due settimane non ha pesate.
- **Periodo**: date `from`–`to` incluse, `from ≤ to`, al massimo 366 giorni, come in Statistiche Dieta.

## Impatto sull'esistente

- Comportamenti che cambiano:
  - Statistiche Palestra non mostra più la card "N giorni di fila" né il testo "Statistiche palestra in arrivo": al loro posto la card "N allenamenti" con i badge palestra e i nuovi blocchi statistici;
  - i badge palestra si sbloccano con gli allenamenti finiti (1 ogni 10) invece che con la serie; chi aveva badge palestra sbloccati dalla serie vede il numero ricalcolato sugli allenamenti, anche in calo;
  - cancellare un allenamento può far tornare bloccato un badge palestra (accettato nel brainstorm);
  - nell'header delle pagine Dieta e Palestra compare un tasto peso in alto a sinistra, che apre un overlay con lo sfondo peso della sezione;
  - nuove grafiche (icona peso e sfondo peso per sezione) entrano come placeholder, in attesa degli asset definitivi;
  - Statistiche Dieta mostra in più il blocco del peso (grafico e storico delle pesate);
  - nella lista Storico lo swipe a sinistra su una card mostra "Elimina";
  - il server MCP espone tre tool in più e le `INSTRUCTIONS` li citano.
- Comportamenti da preservare:
  - serie dei giorni di fila e badge della Dieta: `StreakCard` in cima a Statistiche Dieta, 1 badge ogni 5 giorni della serie attuale, stessi testi;
  - registrazione degli accessi (`POST /api/activity` da `ActivityTracker`) e `GET /api/stats/streak` invariati;
  - resto di Statistiche Dieta: GoalForm, selettore periodo nel query string, grafici kcal e macro, ripartizione, tabella medie, calcolati nel web come oggi;
  - ingranaggio delle impostazioni in alto a destra, nascosto su `/settings`; selettore Dieta|Palestra centrato e visibile solo con `workouts.use`; per chi non ha il permesso palestra l'ingranaggio resta visibile;
  - Storico: raggruppamento per mese, "Carica altri", tap sulla card che apre il dettaglio;
  - dettaglio allenamento: menu con "Salva come modello" ed "Elimina" con la stessa conferma e il ritorno allo Storico;
  - `DELETE /api/workouts/{id}` con le stesse risposte, usato anche per annullare l'allenamento in corso;
  - header della sessione live agganciato al visual viewport;
  - tool MCP esistenti (dieta, alimenti, obiettivi, palestra) con stessi argomenti e output;
  - isolamento per utente su ogni dato e permesso `workouts.use` per le pagine e le API palestra;
  - esercizi custom archiviati ancora visibili nello storico.
- Compatibilità: retrocompatibile. Gli endpoint esistenti non cambiano forma; si aggiungono endpoint REST per peso e statistiche palestra e tre tool MCP. Nessuna nuova variabile d'ambiente né dipendenza.
- Migrazioni: una migrazione Alembic che aggiunge la tabella delle pesate (`user_id` con FK su `users.id` `ON DELETE CASCADE`, `date`, `weight_kg` con un decimale, vincolo unico su (`user_id`, `date`)). Nessuna migrazione di dati. Eventuali indici per le query di progressione solo se servono (ADR 0002).

## Requisiti funzionali

Peso giornaliero:

- **R1**: Nell'header delle pagine della Dieta (`/`, `/week`, `/stats`; non `/search`, che ha un header proprio) e della Palestra che usano `ModeSwitch` deve esserci un tasto peso in alto a sinistra, simmetrico all'ingranaggio (area toccabile 44px, `aria-label="Registra peso"`). Il tasto è visibile anche senza permesso palestra e non compare nelle pagine condivise (`/settings`, Account, admin).
- **R2**: Il tasto deve aprire un overlay a tutto schermo con lo sfondo illustrato "peso" della sezione corrente (come lo sfondo delle impostazioni: uno per Dieta, uno per Palestra) e sopra solo un campo numerico per il peso in kg (tastiera decimale di iOS, accetta la virgola), un pulsante di conferma e un comando per chiudere senza salvare. Niente grafici né storico nell'overlay. Se oggi c'è già una pesata, il campo è precompilato con quel valore.
- **R3**: Confermando, il server deve salvare il peso per il giorno di oggi in `app_timezone`, arrotondato a 1 decimale; se oggi esiste già una pesata la sovrascrive. Il client non invia la data. Valori accettati: da 20,0 a 400,0 kg; fuori intervallo o non numerici l'API risponde 400 e il campo mostra un errore senza chiudersi. Dopo il salvataggio il campo si chiude con una conferma breve e i dati del peso in Statistiche Dieta si aggiornano.
- **R4**: In Statistiche Dieta, sotto i blocchi esistenti e per lo stesso periodo selezionato, deve esserci un blocco Peso con il grafico delle pesate del periodo e la linea della media mobile a 7 giorni, e sotto lo storico delle pesate del periodo (data e kg, dalla più recente). Senza pesate nel periodo mostra "Nessuna pesata nel periodo".
- **R5**: Ogni pesata dello storico deve avere un comando "Elimina" con conferma; dopo l'eliminazione grafico e storico si aggiornano. Non esistono modifica né inserimento per giorni passati.
- **R6**: L'API deve esporre per l'utente autenticato: salvataggio della pesata di oggi, lettura di un periodo (per ogni giorno: peso o nullo e media mobile a 7 giorni; più le medie per settimana ISO con variazione) ed eliminazione di una propria pesata. Le pesate di altri utenti risultano inesistenti (404). Nessun permesso specifico oltre all'autenticazione.

Statistiche palestra (`/gym/stats`):

- **R7**: La pagina deve mostrare in cima la card "N allenamenti" (totale degli allenamenti finiti di sempre, singolare "1 allenamento") con i badge palestra al posto della card della serie. La card della serie non compare più nella Palestra.
- **R8**: I badge palestra devono essere 30, uno ogni 10 allenamenti finiti (collezione completa a 300), con le stesse immagini di oggi. La card mostra "Badge X / 30", "Prossimo badge tra K allenamenti" (o "Collezione completa!"), "Primo badge a 10 allenamenti" se non ce n'è nessuno e, sui badge bloccati della griglia, la soglia in allenamenti. I badge della Dieta restano 1 ogni 5 giorni di serie.
- **R9**: La pagina deve avere lo stesso selettore periodo di Statistiche Dieta (7g / 30g / 90g / Personalizzato, massimo 366 giorni, niente date future, periodo nel query string, default 7) e, per quel periodo, un riepilogo con numero di allenamenti, volume totale in kg e durata media.
- **R10**: Per il periodo la pagina deve mostrare un grafico a barre della frequenza settimanale (allenamenti per settimana ISO, settimane vuote a zero).
- **R11**: La pagina deve permettere di scegliere un esercizio tra quelli presenti in almeno un allenamento finito dell'utente (custom archiviati compresi), ordinati dal più recente; default l'ultimo usato, scelta salvata nel query string. Per l'esercizio scelto mostra un grafico per sessione nel periodo con le metriche del suo tracking (selezionabili una alla volta) e sotto lo storico delle serie per sessione (data e serie formattate come nello Storico, dalla più recente).
- **R12**: Per l'esercizio scelto la pagina deve mostrare i record personali di tutto lo storico secondo il tracking, ciascuno con la data.
- **R13**: Stati vuoti: senza allenamenti nel periodo, riepilogo a zero e "Nessun allenamento nel periodo"; senza nessun allenamento finito, al posto di progressione e record "Completa un allenamento per vedere i progressi". Un errore di caricamento di un blocco mostra un messaggio in quel blocco e il resto della pagina funziona.
- **R14**: L'API deve esporre per l'utente con `workouts.use`: conteggio degli allenamenti finiti, statistiche del periodo (allenamenti, volume, durata media, frequenza settimanale), elenco degli esercizi eseguiti, progressione di un esercizio nel periodo con le serie per sessione e i record personali. Periodo non valido → 400; esercizio inesistente o custom di un altro utente → 404; permesso mancante → 403.

Storico:

- **R15**: Nella lista Storico, uno swipe orizzontale verso sinistra su una card deve rivelare un pulsante "Elimina". Il gesto si attiva solo con movimento prevalentemente orizzontale oltre una soglia, così lo scroll verticale resta normale. Una sola card aperta alla volta; swipe a destra o tap fuori la richiude; un tap su una card aperta la richiude senza aprire il dettaglio.
- **R16**: Premendo "Elimina" compare la stessa conferma del dettaglio ("Eliminare questo allenamento dallo storico?"); confermando l'allenamento è cancellato con `DELETE /api/workouts/{id}` e sparisce dalla lista; annullando la card si richiude. Un errore mostra un messaggio e la card resta.

MCP:

- **R17**: Tool `get_weight_history(start?, end?)`: per ogni giorno del periodo peso (o null) e media mobile a 7 giorni, più le medie per settimana ISO con numero di pesate e variazione rispetto alla settimana precedente. Default `end` = oggi, `start` = `end` − 29 giorni; massimo 366 giorni.
- **R18**: Tool `get_exercise_progress(exercise_id, start?, end?)`: nome e tracking dell'esercizio, per ogni sessione del periodo data, `workout_id` e metriche del tracking, più i record personali di sempre con data. Default `end` = oggi, `start` = `end` − 89 giorni; massimo 366 giorni.
- **R19**: Tool `get_gym_stats(start?, end?)`: numero di allenamenti, volume totale, durata media e frequenza per settimana ISO nel periodo. Stessi default di R17.
- **R20**: I tre tool sono di sola lettura, agiscono solo sull'utente del token e usano gli stessi servizi degli endpoint REST, quindi restituiscono gli stessi numeri dell'app. `get_exercise_progress` e `get_gym_stats` richiedono `workouts.use`; `get_weight_history` solo l'accesso MCP. Le `INSTRUCTIONS` del server citano i nuovi tool. Non esistono tool per scrivere pesate né per cancellare allenamenti.

Grafiche:

- **R21**: Tutte le grafiche nuove della feature usano un placeholder già nel percorso e nel formato finali, così la sostituzione con l'asset definitivo è solo un cambio di file. Grafiche nuove: icona del tasto peso per Dieta e per Palestra (stesso formato e dimensioni delle icone dell'header, es. l'ingranaggio) e sfondo "peso" per Dieta e per Palestra (stesso formato e inquadratura dello sfondo delle impostazioni, portrait ancorato in basso, landscape centrato con i bordi sfumati). I placeholder sono semplici e riconoscibili (es. bilancia stilizzata, tinta della sezione).
- **R22**: A fine feature deve esistere `docs/features/2026-10-02-statistiche-palestra-peso/art-prompts.md` con un prompt pronto per un generatore di immagini OpenAI per ciascuna delle 4 grafiche di R21: stile coerente con le illustrazioni esistenti (pixel art con i gatti della sezione, palette di `web/art/dieta` e `web/art/palestra`), soggetto a tema peso/bilancia, dimensioni, proporzioni, sfondo (trasparente per le icone) e nome del file sorgente atteso in `web/art/{dieta,palestra}/`. Il documento dice anche come integrare i file ricevuti (cartella sorgente e comando di build delle grafiche).

## Requisiti non funzionali

- Coerenza: ogni metrica ha una sola implementazione lato server usata da REST e MCP (ADR 0002). Il web non ricalcola media mobile, 1RM, volume o record.
- Prestazioni: le statistiche palestra e peso di un periodo di 366 giorni si caricano con poche query aggregate, senza scaricare lo storico paginato nel web e senza tabelle di cache.
- Sicurezza: ogni query filtra per `user_id` dell'utente autenticato; le scritture REST passano dal middleware CSRF esistente.
- Usabilità iPhone: il campo peso usa `inputmode="decimal"`; lo swipe non interferisce con lo scroll verticale né con il gesto "indietro" dal bordo sinistro.
- Nessuna nuova dipendenza web o API; grafici SVG fatti a mano come in `web/src/components/stats/`.

## Criteri di accettazione

Verificabili con test automatici (`cd web && npm test` in locale; pytest sul deploy remoto):

- **C1** (R1): Dato un utente sulla pagina Giorno e poi su Storico palestra, quando la pagina viene renderizzata, allora l'header mostra il pulsante "Registra peso" a sinistra e l'ingranaggio a destra; su `/settings` il pulsante peso non c'è. Dato un utente senza `workouts.use`, sulla pagina Giorno il pulsante peso c'è e il selettore Dieta|Palestra no.
- **C2** (R2, R3): Dato il campo peso aperto, quando l'utente scrive "78,4" e conferma, allora parte una richiesta di salvataggio con 78.4 e senza data, il campo si chiude e la query del peso viene invalidata. Dato che oggi esiste già 78.4, quando il campo si apre è precompilato con 78,4. Con "abc" o 15 la conferma mostra un errore e il campo resta aperto.
- **C3** (R3, R6): Eseguendo pytest sul deploy remoto, due salvataggi nello stesso giorno locale producono una sola riga con l'ultimo valore; il giorno è calcolato con `app_timezone` (alle 23:30 UTC del 1 ottobre la pesata va al 2 ottobre a Roma); 78.46 viene salvato come 78.5; 19.9 e 400.1 ricevono 400; una scrittura senza `X-Requested-With` riceve 403.
- **C4** (R6, media mobile): Eseguendo pytest sul deploy remoto, dato pesate il 1, 3 e 8 ottobre, quando si legge il periodo 7–10 ottobre, allora ogni giorno è presente; il 7 ha peso nullo e media delle pesate di 1 e 3; l'8 ha media di 3 e 8; il 10 ha media della sola pesata dell'8; un giorno senza pesate nei 7 giorni precedenti ha media nulla. Le medie settimanali usano tutta la settimana ISO, con variazione nulla se la settimana precedente non ha pesate.
- **C5** (R5, R6): Eseguendo pytest sul deploy remoto, un utente elimina una propria pesata (204) e non può eliminare né leggere quelle di un altro utente (404); un periodo con `from > to` o oltre 366 giorni riceve 400.
- **C6** (R4, R5): Dato `DietStatsPage` con pesate finte nel periodo, quando la pagina è renderizzata, allora il blocco Peso mostra grafico, linea della media mobile e storico dalla più recente; premendo "Elimina" su una pesata e confermando parte la cancellazione di quella pesata; annullando non parte nulla. Senza pesate compare "Nessuna pesata nel periodo".
- **C7** (R7, R8): Dato `GymStatsPage` con 23 allenamenti finiti (dati finti), quando la pagina è renderizzata, allora compare "23 allenamenti", "Badge 2 / 30", "Prossimo badge tra 7 allenamenti" e nessun testo "giorni di fila". Con 0 allenamenti compare "Primo badge a 10 allenamenti"; con 300 o più "Collezione completa!". La regola dei badge palestra è testata come funzione pura (0, 9, 10, 299, 300, 350).
- **C8** (R9, R10, R13): Dato `GymStatsPage`, quando l'utente sceglie 30g o un intervallo personalizzato valido, allora la richiesta delle statistiche usa quel periodo e il query string si aggiorna; un intervallo non valido mostra l'errore e non parte nessuna richiesta. Con dati finti la pagina mostra numero di allenamenti, volume, durata media e una barra per settimana; senza allenamenti nel periodo mostra "Nessun allenamento nel periodo".
- **C9** (R9, R10, R14, definizioni): Eseguendo pytest sul deploy remoto, dato un utente con due allenamenti finiti nel periodo (60 e 90 minuti, serie 100 kg × 5 e 80 kg × 8, più una serie `reps` senza peso e una a durata) e uno in corso, quando si leggono le statistiche del periodo, allora risultano 2 allenamenti, volume 1140 kg, durata media 75 minuti, e la frequenza ha una voce per ogni settimana ISO del periodo con gli zeri. L'allenamento in corso e quelli di un altro utente non contano.
- **C10** (R11, R12, R14, definizioni): Eseguendo pytest sul deploy remoto, per un esercizio `weight_reps` con sessioni 100 kg × 5 e 105 kg × 1 la progressione riporta per sessione carico massimo, 1RM (116,7 e 105,0) e volume, e i record peso massimo 105 kg, 1RM 116,7 kg, reps massime 5, ciascuno con la data giusta. Un esercizio `reps` riporta reps massime e totali; uno `duration` durata massima e totale. Un esercizio custom archiviato dell'utente è ancora leggibile; quello custom di un altro utente riceve 404; un utente senza `workouts.use` riceve 403. L'elenco degli esercizi eseguiti contiene solo esercizi presenti in allenamenti finiti dell'utente, dal più recente.
- **C11** (R11, R12, R13): Dato `GymStatsPage` con dati finti, quando l'utente sceglie un esercizio, allora la scelta va nel query string e la pagina mostra il grafico con le metriche del suo tracking, lo storico delle serie e i record con la data. Senza nessun allenamento finito compare "Completa un allenamento per vedere i progressi".
- **C12** (R15, R16): Dato `HistoryPage` con due allenamenti, quando l'utente trascina una card verso sinistra oltre la soglia, allora compare "Elimina"; premendolo e confermando parte `DELETE /api/workouts/{id}` di quella card e la lista viene aggiornata; annullando non parte nulla e la card si richiude. Un trascinamento prevalentemente verticale non apre la card. Aprendo la seconda card la prima si richiude.
- **C13** (R17, R19, R20): Eseguendo pytest sul deploy remoto con il client MCP in-memory, `get_weight_history` e `get_gym_stats` restituiscono gli stessi valori dei rispettivi endpoint REST per lo stesso periodo, usano i default di periodo descritti e rifiutano un periodo oltre 366 giorni. `get_gym_stats` senza `workouts.use` restituisce un errore di permesso.
- **C14** (R18, R20): Eseguendo pytest sul deploy remoto, `get_exercise_progress` restituisce sessioni e record coerenti con C10 e, per l'esercizio custom di un altro utente, l'errore "not found" senza dati. L'elenco dei tool registrati non contiene tool per scrivere pesate o cancellare allenamenti.

Verificabili solo sul dispositivo (iPhone, PWA installata, deploy remoto):

- **C30** (R2, R21): Dato il tasto peso nella Dieta e poi nella Palestra, quando l'overlay si apre, allora mostra lo sfondo peso della sezione corrente (percorsi diversi per Dieta e Palestra) e il campo; il comando di chiusura lo chiude senza richieste di salvataggio. Il tasto usa l'icona peso della sezione.
- **C31** (R21, R22): Le 4 grafiche placeholder esistono nei percorsi serviti dall'app e il comando di build delle grafiche le produce senza errori; `art-prompts.md` contiene 4 prompt, ognuno con il nome del file sorgente atteso.

- **C15** (R2, NFR usabilità): Toccando il tasto peso si apre il campo con la tastiera decimale di iOS, la virgola funziona e il campo non è coperto dalla tastiera.
- **C16** (R15, NFR usabilità): Nello Storico lo scroll verticale scorre senza aprire card, lo swipe a sinistra su una card rivela "Elimina" e lo swipe dal bordo sinistro torna indietro come prima.

Comportamenti da preservare:

- **C17** (preservare): Dato un utente con una serie di 12 giorni, quando apre Statistiche Dieta, allora vede in cima "12 giorni di fila", "Record: M" e "Badge 2 / 30" con "Prossimo badge tra 3 giorni", come prima (test esistenti di `StreakCard.test.tsx`, `BadgeGrid.test.tsx`, `badges.test.ts` verdi).
- **C18** (preservare): Eseguendo pytest sul deploy remoto, i test esistenti di `test_activity_router.py` e `test_streak.py` passano senza modifiche; `ActivityTracker` chiama ancora `POST /api/activity` al montaggio.
- **C19** (preservare): Dato Statistiche Dieta, quando l'utente cambia periodo o modifica gli obiettivi, allora GoalForm, grafici kcal e macro, ripartizione e tabella si comportano come prima (test esistenti di `DietStatsPage.test.tsx`, `GoalForm.test.tsx`, `stats.test.ts`, `charts.test.tsx` verdi).
- **C20** (preservare): Dato un header con `ModeSwitch`, l'ingranaggio porta a `/settings` ed è assente su `/settings`; il selettore Dieta|Palestra compare solo con `workouts.use` e porta all'ultima pagina della sezione (test esistenti di `ModeSwitch.test.tsx`, `AppShell.test.tsx`, `appMode.test.ts` verdi).
- **C21** (preservare): Dato lo Storico, quando l'utente tocca una card chiusa, allora si apre il dettaglio `/gym/history/:id`; "Carica altri" carica la pagina successiva e le card restano raggruppate per mese.
- **C22** (preservare): Dato il dettaglio di un allenamento, quando l'utente sceglie "Elimina" dal menu e conferma, allora l'allenamento è cancellato e si torna allo Storico; "Salva come modello" funziona come prima (test esistenti di `WorkoutDetailPage.test.tsx` verdi).
- **C23** (preservare): Eseguendo pytest sul deploy remoto, `DELETE /api/workouts/{id}` cancella ancora un allenamento finito o in corso dell'utente (204) e risponde 404 per l'allenamento di un altro utente (test esistenti di `test_gym_routers.py` e `test_workouts_finish.py` verdi).
- **C24** (preservare): Dato un allenamento in corso con visual viewport spostato, l'header della sessione live resta agganciato alla parte visibile (test esistenti di `useVisualViewportTop.test.ts` e `WorkoutPage.test.tsx` verdi).
- **C25** (preservare): Eseguendo pytest sul deploy remoto, i test esistenti dei tool MCP (`test_mcp_tools_diary.py`, `test_mcp_tools_foods.py`, `test_mcp_tools_workouts.py`, `test_permissions_mcp.py`) passano senza modifiche.
- **C26** (preservare): Eseguendo pytest sul deploy remoto, ogni nuovo endpoint e tool restituisce solo dati dell'utente autenticato: con due utenti con pesate e allenamenti, nessuna risposta dell'uno contiene valori dell'altro; senza sessione gli endpoint REST rispondono 401.
- **C27** (preservare): Dato un esercizio custom archiviato usato in un allenamento passato, lo Storico e il dettaglio lo mostrano ancora e le statistiche lo includono.

Non regressione:

- **C28** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano, anche quelli esistenti.
- **C29** (non regressione): Eseguendo la suite pytest dell'API sul deploy remoto (dopo push del branch e `git pull` sul server), tutti i test passano, anche quelli esistenti, e la migrazione si applica senza errori su un DB con dati esistenti e si annulla con `alembic downgrade -1`.

## Fuori scope

- Più pesate nello stesso giorno, modifica di una pesata, inserimento per giorni passati.
- Tool MCP `log_weight` e `delete_workout`.
- Obiettivo di peso, BMI, composizione corporea, unità diverse dai kg.
- Badge palestra con soglie crescenti; modifiche ai badge e alla serie della Dieta.
- Spostare il calcolo delle statistiche Dieta lato server o esporle via MCP.
- Cancellazione multipla di allenamenti; swipe nel dettaglio o in altre liste.
- Riepiloghi precalcolati, tabelle di cache.
- Record personali per ripetizioni (miglior peso a 3, 5, 10 reps) e confronti tra esercizi.
- Le grafiche definitive: l'utente le genera con OpenAI dai prompt di R22 e le consegna in uno zip; la loro integrazione è un passo successivo che sostituisce solo i placeholder.

## Rischi

- Lo swipe può confliggere con lo scroll verticale e con il gesto "indietro" di iOS. Mitigazione: attivazione solo con movimento prevalentemente orizzontale oltre una soglia, nessun gesto avviato vicino al bordo sinistro, C12 e C16 sul dispositivo.
- Il tasto peso a sinistra deve convivere con il selettore centrato: il `px-14` di `ModeSwitch` lascia già lo spazio, ma su schermi stretti va verificato con C1 e a vista su iPhone.
- I badge palestra di chi li aveva sbloccati con la serie possono scendere: è un cambio di regola voluto, nessuna migrazione.
- Le metriche sono testate solo in pytest sul deploy remoto. Mitigazione: funzioni pure per Epley, media mobile e medie settimanali testabili senza DB, più C4, C9, C10 sul deploy; i test web usano dati finti.
- Query di progressione su tutto lo storico (record personali): adeguate per pochi utenti; se lente si aggiungono indici, non cache (ADR 0002).
- Doppia data "oggi": il peso usa `app_timezone` sul server, il selettore periodo usa la data del dispositivo (`todayIso`). Con dispositivo fuori fuso la pesata di oggi può cadere fuori dal periodo per qualche ora; accettato come per la serie.

## Domande aperte

Nessuna.
