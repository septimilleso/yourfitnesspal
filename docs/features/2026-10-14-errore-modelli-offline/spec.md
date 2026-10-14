# Bug: "Errore nel caricamento dei modelli." in modalità aereo nell'IPA

- Data: 2026-10-14
- Tipo: bug
- Stato: approvato

## Sintomo

Nell'IPA v0.0.3, in modalità aereo, dopo aver aperto l'app con rete e lasciato fare il precarico, "ogni tanto" compare "Errore nel caricamento dei modelli." (`web/src/pages/gym/GymStartPage.tsx:141`, ramo `templates.isError`). Ci si aspetterebbe invece di vedere i modelli già scaricati o il messaggio "Non disponibile offline".

## Passi per riprodurre

1. Installare l'IPA v0.0.3, fare login con rete e lasciare l'app aperta qualche secondo per il precarico.
2. Attivare la modalità aereo.
3. Aprire Palestra / Modelli: i modelli in cache compaiono.
4. Passare a un'altra schermata (per esempio Storico) e restarci almeno 20 secondi, oppure mandare l'app in background e riportarla in primo piano.
5. Tornare su Modelli: compare l'errore rosso, e resta finché la rete non torna.

"Ogni tanto" dipende dai tempi: l'errore compare solo se tra il passo 4 e il passo 5 parte un tentativo di ripresa della connessione. Questo succede ogni 20 s, al ritorno in primo piano o sull'evento `online`.

## Atteso e osservato

- Atteso: offline la schermata mostra i modelli precaricati, oppure "Non disponibile offline" se non ci sono dati. Mai un errore rosso, perché un errore di rete non deve portare una query in stato `error` (R4 delle feature `ipa-apertura-offline` e `ipa-precarico-offline`).
- Osservato: dopo i passi sopra compare "Errore nel caricamento dei modelli." al posto dei modelli o sopra di essi.

## Ambiente

IPA v0.0.3 (tag su `dda4bbc`), iPhone, SideStore. Frequenza: "ogni tanto". Prima apparizione: v0.0.3. La v0.0.2 aveva lo stesso difetto, ma solo per le schermate già visitate online: con il precarico quasi ogni query ha dati in cache, e i dati in cache sono la condizione del bug. Contesto delle feature: `docs/features/2026-10-12-ipa-apertura-offline/` e `docs/features/2026-10-13-ipa-precarico-offline/`.

## Causa radice

Il design offline (piano di `ipa-apertura-offline`, decisione "Rete") presume che, con `retryNative`, un `NetworkError` lasci la query in `success` con i dati e il suo retryer in pausa per sempre. Questo vale solo finché la query ha almeno un osservatore. Quando la schermata viene smontata, React Query annulla i ritenti, e al primo tentativo di ripresa della connessione il retryer rifiuta con il `NetworkError`. La query passa così in `status: "error"` e tiene i dati.

Catena da causa a sintomo (React Query 5.102.5, `web/node_modules/@tanstack/query-core/build/modern/`):

1. **Dati in cache.** Il precarico (`web/src/native/prefetch.ts`, `set` → `setQueryData`) o il ripristino da file (`web/src/native/queryPersistence.ts`, `asSuccessfulQuery`) lasciano `["gym","templates"]` in `success` con dati. Questo è corretto.
2. **Apertura offline.** Aprendo Modelli offline, `useTemplates` (`web/src/api/gym.ts:288`, `staleTime` 0) fa un refetch al montaggio. `onlineManager` è offline (`web/src/native/connectivity.ts`, `reportNetworkFailure`), quindi il retryer parte in pausa: `retryer.js`, `start()` → `pause().then(run)`. La query è in `success` con `fetchStatus: "paused"` e la pagina mostra i modelli.
3. **Smontaggio della schermata.** Uscendo da Modelli l'ultimo osservatore si stacca. In `query.js:132-140` (`removeObserver`), React Query annulla con ripristino dello stato precedente (`cancel({ revert: true })`) solo le query in pausa senza dati (`status === "pending"`). Per una query con dati chiama invece `this.#retryer.cancelRetry()`, che imposta `isRetryCancelled = true`.
4. **Tentativo di ripresa.** Entro 20 s il tentativo di ripresa (`web/src/native/connectivity.ts:42-56`, `retryConnection()` dall'intervallo di `startConnectivityRecovery`, dal ritorno in primo piano o dall'evento `online`) chiama `onlineManager.setOnline(true)`. `query.js:117-120` (`onOnline`) fa allora `this.#retryer?.continue()`.
5. **Il retryer rifiuta.** Il retryer esegue la `queryFn`. `fetch` rifiuta, e `fetchNative` (`web/src/api/client.ts:32-42`) lo converte correttamente in `NetworkError`. Ma in `retryer.js:93-95` `isRetryCancelled` è vero: `retryNative` non viene nemmeno consultato e il retryer fa `reject(error)`. Nel ramo che passa da `sleep`, `retryer.js:102` rifiuta anche senza nuova richiesta.
6. **Query in errore.** `query.js:262-267` fa `dispatch({ type: "error" })`: `status: "error"` con i dati conservati. `QueryCache.onError` in `web/src/lib/queryClient.ts:13-18` gestisce solo il 401 e non tocca il resto.
7. **L'errore resta.** Tornando su Modelli, il refetch al montaggio non azzera lo stato, perché `fetchState` (`query.js:345-354`) riporta a `pending` solo se `data === undefined`. La query resta quindi in `error` per tutto il tempo offline, con `fetchStatus` in pausa. `useOfflineUnavailable` (`web/src/lib/useOfflineUnavailable.ts:20-22`) è falso perché i dati ci sono, quindi `GymStartPage.tsx:140-142` mostra "Errore nel caricamento dei modelli.".

Riproduzione: ho riprodotto il bug in modo deterministico con un test vitest temporaneo, poi cancellato. Il test usa `createQueryClient(true)`, `isNative` mockato e `fetch` che rifiuta con `TypeError("Load failed")`, ed esegue `setQueryData(gymKeys.templates, …)`, `reportNetworkFailure()`, render di `GymStartPage`, smontaggio, `retryConnection()` e un nuovo render. Stati osservati:
- dopo il montaggio: `success`/`paused`;
- dopo lo smontaggio: `success`/`paused`;
- dopo `retryConnection()`: `error`/`idle` con `NetworkError`.

Al secondo render compare "Errore nel caricamento dei modelli.". Con la correzione proposta, simulata nel test con un `QueryClient` locale, lo stato finale è `success`/`idle` e i modelli restano visibili.

Ipotesi iniziali, verificate:

- (a) Errore non `NetworkError` durante la lettura del body: non è la causa. In modalità aereo non arrivano risposte, e il bug si riproduce con il solo `NetworkError`. Resta un difetto secondario, vedi "Fuori scope".
- (b) `isError` mostrato prima dei dati: è dove si vede il sintomo, non la causa. Con la correzione un errore di rete non produce più `isError` quando ci sono dati.
- (c) Precarico o ripresa della connessione:
  - il precarico non mette la query in uno stato anomalo (`setQueryData` dà `success`/`idle`), ma rende frequente la condizione necessaria, cioè i dati in cache;
  - la ripresa ogni 20 s è il trigger che fa rifiutare il retryer;
  - il ripristino da file dà `success`/`idle` ed è corretto.
- WKWebView: il codice assume che ogni rifiuto di `fetch` sia un errore di rete, compreso un `AbortError`. Nessuna `queryFn` passa un `signal`, quindi oggi non ci sono `AbortError` e questo non è la causa.

## Correzione proposta

Correzione generale nel client nativo, non pagina per pagina, in `web/src/lib/queryClient.ts`, dentro `createQueryClient(native)`. Nel `QueryCache.onError`, solo se `native` è vero e l'errore è un `NetworkError` di una query che ha dati (`query.state.data !== undefined`), si riporta la query allo stato riuscito con `query.setState({ ...query.state, status: "success", error: null, fetchStatus: "idle", fetchFailureCount: 0, fetchFailureReason: null })`.

Cosa si conserva:
- **Ora dei dati.** `dataUpdatedAt` resta, quindi l'ora mostrata dall'indicatore offline non cambia.
- **Refetch al montaggio.** `isInvalidated` resta, quindi la prossima apertura della schermata rifà il refetch.
- **Gestione del 401.** Il ramo che porta `["me"]` a `null` resta invariato e viene valutato prima.

Perché funziona:
- `#dispatch` e `setState` notificano gli osservatori in un unico batch di `notifyManager`, quindi non c'è un fotogramma con l'errore rosso. L'ho verificato nel test temporaneo.
- Le query senza dati non si toccano. React Query le annulla già con ripristino dello stato quando sono in pausa senza osservatori (`query.js:138`). Se restano in `error`, al rimontaggio `fetchState` le riporta a `pending`/`paused`, e `useOfflineUnavailable` mostra "Non disponibile offline".

Alternative scartate:
- Annullare con ripristino le query in pausa sull'evento `observerRemoved`: serve una condizione in più per il ramo `sleep` del retryer, e fa la stessa cosa con più codice.
- Passare il `signal` di React Query a tutte le `queryFn`: React Query farebbe da sé l'annullamento con ripristino, ma bisognerebbe toccare tutte le funzioni di `api/*`. Inoltre bisognerebbe distinguere l'`AbortError` in `fetchNative`, che oggi lo segnala come rete assente e accenderebbe un falso stato offline.

## Altri punti colpiti

La causa è nel client, e colpisce ogni query con dati che viene smontata mentre il suo refetch è in pausa offline. La correzione generale le copre tutte, senza modifiche alle pagine. Punti in cui il sintomo si vede:

- **Errore rosso sopra i dati:**
  - `web/src/pages/gym/GymStartPage.tsx:141` (caso segnalato);
  - `web/src/pages/DayPage.tsx:103`;
  - `web/src/pages/WeekPage.tsx:208`;
  - `web/src/pages/SavedWeeksPage.tsx:33`;
  - `web/src/pages/SavedWeekDetailPage.tsx:89` ("Settimana non trovata.");
  - `web/src/pages/gym/HistoryPage.tsx:82`;
  - `web/src/pages/gym/WorkoutDetailPage.tsx:68` ("Allenamento non trovato.");
  - `web/src/components/gym/ExerciseDetailSheet.tsx:34`;
  - `web/src/pages/AccountPage.tsx:124` (sessioni).
- **Errore rosso al posto dei dati, con i dati nascosti:**
  - `web/src/pages/DietStatsPage.tsx:51`;
  - `web/src/pages/gym/GymStatsPage.tsx:40`;
  - `web/src/components/StreakCard.tsx:17`;
  - `web/src/components/WorkoutCountCard.tsx:17`;
  - `web/src/components/stats/WeightSection.tsx:33`;
  - `web/src/components/stats/ExerciseProgressSection.tsx:60` e `:110`;
  - `web/src/components/gym/ExerciseList.tsx:19` (pagina Esercizi e picker);
  - `web/src/pages/gym/WorkoutPage.tsx:100`: l'allenamento attivo non è persistito, ma resta in memoria se si va offline durante la sessione.
- **Stesso meccanismo, raro in pratica:** `web/src/components/McpConnectionsSection.tsx:55`, `web/src/pages/admin/AdminUsersPage.tsx:68`.
- **Non colpiti:** `web/src/components/RestAlertSetting.tsx:103` è solo web; `web/src/pages/ConnectPage.tsx:38` non è autenticato, usa `retry: false` e non ha dati in cache.

## Impatto sull'esistente

- Comportamenti che cambiano, solo nell'IPA: una query con dati in cache il cui caricamento finisce con un errore di rete resta "riuscita" e mostra i dati invece di un errore rosso. Questo vale offline e anche con una rete instabile; lo stato offline lo segnala già il puntino. Gli errori HTTP (4xx, 5xx, risposta non JSON) restano errori come oggi. Il 401 di sessione porta ancora al login. Nel browser e nella PWA nessun cambiamento: il ramo è dietro `native` e il client web non produce `NetworkError`.
- Dati già salvati male: Nessuno. Lo stato `error` vive solo in memoria, e il file di cache normalizza già le query a `success` (`asSuccessfulQuery` in `web/src/native/queryPersistence.ts`).

## Criteri di accettazione

- **C1** (riproduzione):
  - Dato il client nativo con `["gym","templates"]` in cache (come dopo il precarico) e la rete assente, quando si apre Modelli, si passa a un'altra schermata, parte un tentativo di ripresa della connessione (`retryConnection()`, ogni 20 s) e si torna su Modelli, allora compaiono i modelli in cache, la query è in `success` e non compare "Errore nel caricamento dei modelli.".
  - Senza dati in cache, negli stessi passi compare "Non disponibile offline".
  - Gli stessi passi su un'altra schermata con dati in cache, per esempio `HistoryPage` o `DayPage`, non mostrano il suo errore rosso.
- **C2** (test di regressione): Esiste un test automatico nuovo, per esempio `web/src/pages/gym/GymStartPage.offlineError.native.test.tsx`, che esegue i passi di C1:
  - imposta i modelli con `setQueryData` e chiama `reportNetworkFailure()`;
  - fa render, smontaggio, `retryConnection()` e un nuovo render;
  - verifica sia il testo della pagina sia lo stato della query.

  Il test fallisce senza la correzione (stato `error`, errore rosso) e passa con la correzione. Lo stesso file verifica anche che:
  - un `ApiError` 502 su una query con dati porti ancora la query in `error`;
  - un 401 su una query diversa da `["me"]` porti ancora `["me"]` a `null`.

  I test esistenti `web/src/lib/queryClient.test.ts` e `web/src/components/OfflineIndicator.test.tsx` passano senza modifiche.
- **C3** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano.
- **C4** (dispositivo): Sull'iPhone, con l'IPA corretta, dopo un'apertura con rete si attiva la modalità aereo. Si apre Modelli, si va su Storico per almeno 30 s, si torna su Modelli: i modelli sono visibili e non compare l'errore rosso. Lo stesso vale andando in background e tornando, e per Giorno e Statistiche.

## Fuori scope

- Azioni di scrittura offline (segnare esercizi, aggiungere o togliere cibo) e cache dei cibi (`foods*`): fanno parte della feature "palestra offline completa con sync" (ADR 0004), che l'utente vuole fare dopo, in una nuova chat.
- Nuovo precarico o nuove schermate offline.
- L'ordine "errore prima dei dati" nelle pagine per gli errori HTTP veri (5xx con dati in cache): è il comportamento di oggi, anche online e sul web, e non riguarda la rete assente.
- Difetti secondari del client, possibili follow-up:
  - `request()` in `web/src/api/client.ts` non converte in `NetworkError` un errore durante `response.json()`, per esempio una connessione caduta a metà body;
  - `retryNative` (`web/src/lib/retry.ts:4`) conta anche i `NetworkError` in `failureCount`, quindi dopo tre tentativi di rete un solo errore non di rete chiude subito il retryer in `error`;
  - `fetchNative` tratta un `AbortError` come rete assente.

  Nessuno di questi produce il bug in modalità aereo.

## Domande aperte

- Nessuna bloccante. La causa è riprodotta in modo deterministico con un test, ma resta da confermare sul dispositivo (C4) che il caso visto dall'utente seguisse questi passi: uscire da Modelli e tornarci dopo un tentativo di ripresa. Se l'errore comparisse anche senza lasciare la schermata, l'ipotesi successiva per probabilità è (a): un errore non di rete, come la lettura del body interrotta al passaggio in modalità aereo, arrivato dopo almeno tre `NetworkError` nello stesso retryer (vedi "Fuori scope", secondo punto).
