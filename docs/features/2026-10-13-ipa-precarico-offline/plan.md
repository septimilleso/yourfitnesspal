# Piano: IPA, precarico delle schermate per l'offline, indicatore offline discreto e messaggio "non disponibile offline"

- Data: 2026-10-13
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: feature
- Branch: `feature/ipa-precarico-offline`

## Approccio

Il lavoro sta tutto nel client web (`web/src`), dietro `isNative()`, senza nuove dipendenze e senza toccare `api/`. Il piano ha cinque parti, nell'ordine dei task:

- **Fondamenta.** Test di caratterizzazione sul codice da modificare che oggi non ha test. Poi l'esportazione di chiavi e funzioni di lettura dai moduli `web/src/api/*`, così pagine e precarico usano la stessa `queryFn`.
- **Logica del precarico.** Un modulo `web/src/native/prefetch.ts` esegue un "giro". Un modulo `web/src/native/prefetchScheduler.ts` decide quando farlo partire. Una funzione separata pulisce le query vecchie.
- **Messaggio offline.** Un hook `useOfflineUnavailable` e un componente `OfflineUnavailable` condivisi, applicati alle pagine di R12, un gruppo di pagine per task.
- **Indicatore e servizi.** `OfflineBar` viene sostituito da `OfflineIndicator`, messo negli header. Un componente `NativeOfflineServices` in `App.tsx` avvia la ripresa della connessione e il precarico.
- **Diagnostica, documentazione, verifiche.** Riga in Impostazioni, README, non regressione, prova sull'iPhone.

Codice riusato:

- `web/src/native/connectivity.ts`: `isOffline`, `subscribeConnectivity`, `startConnectivityRecovery`, `reportNetworkFailure`;
- `web/src/native/session.ts`: `getToken`;
- `web/src/native/queryPersistence.ts`: coda, `CACHE_PATH`, `Filesystem`;
- `web/src/lib/queryClient.ts`: `createQueryClient`;
- `web/src/lib/date.ts`: `todayIso`, `shiftIsoDate`, `startOfWeek`;
- `web/src/lib/stats.ts`: `PRESETS`, `presetPeriod`;
- `web/src/api/gym.ts`: `gymKeys`, `EMPTY_FILTERS`;
- `savedWeekKeys` e `weightKeys`;
- il calcolo dell'ora già presente in `web/src/components/OfflineBar.tsx`.

Decisioni di design (valgono per tutti i task):

- **Dove vive il precarico.** Il giro è in `web/src/native/prefetch.ts` (`runPrefetchRound`), lo scheduler in `web/src/native/prefetchScheduler.ts` (`startPrefetch`), la pulizia in `web/src/native/cachePrune.ts` (`pruneStaleQueries`). Vivono in `native/` come `queryPersistence` e `connectivity`. Nessuno di questi moduli va importato da `api/client.ts` o da `queryPersistence.ts`: il ciclo `client.ts` → `queryPersistence.ts` → `api/gym.ts` → `client.ts` esiste già. Inoltre nei moduli `api/*` le nuove funzioni sono solo dichiarazioni di funzione, senza valori calcolati a livello di modulo, per non rischiare un TDZ.
- **Come si scarica.** Il giro non usa `fetchQuery` né `prefetchQuery`. Chiama direttamente le funzioni di lettura esportate da `api/*` (T3) e, se la risposta arriva, scrive il dato con `queryClient.setQueryData(chiave, dato)`. Il motivo: `fetchQuery` passerebbe da `retryNative`, con pausa offline e 3 ritenti dei 4xx, e un errore lascerebbe la query in stato `error` con i dati, che `StreakCard` e le altre mostrerebbero come errore. Con la chiamata diretta:
  - ogni richiesta parte una sola volta;
  - un errore non tocca mai lo stato della query in cache (R7);
  - nessuna query resta in pausa (C6).

  Per lo storico (`useInfiniteQuery`) il dato scritto è `{ pages: [primaPagina], pageParams: [null] }`. Non si scrive se `["gym","history"]` ha osservatori, per non accorciare le pagine già caricate dalla `HistoryPage` aperta. La pagina serve comunque per scegliere i dettagli.
- **401 nel precarico.** `client.ts` rimuove già token e file (solo se il token è quello della richiesta). Siccome il giro non passa dalla `QueryCache`, il suo `onError` non scatta. Su un `ApiError` 401 il giro fa allora le stesse due cose del `QueryCache.onError` di `createQueryClient`: `setQueryData(["me"], null)` e `invalidateQueries({ queryKey: ["me"] })`. Poi si chiude. `AuthGuard` nativo vede il token assente e va al login (C21).
- **Errore di rete.** È un `NetworkError` (da `api/client.ts`). Il client ha già chiamato `reportNetworkFailure()`, quindi stato offline e puntino seguono le regole di oggi. Il giro si chiude senza altre richieste.
- **Legame con la sessione (R8).** All'inizio il giro salva `token = getToken()`. Prima di ogni richiesta e prima di ogni `setQueryData` controlla `getToken() === token`; se non è più così, il giro si chiude. Il logout fa `clearToken()` prima di `queryClient.clear()`, e un nuovo login salva un token diverso, quindi nessuna risposta in ritardo può ripopolare la cache.
- **Concorrenza (R11).** C'è una coda di compiti, dove ogni compito è una funzione asincrona che può restituire compiti figli (per esempio l'elenco dei modelli genera i dettagli). Due "lavoratori" pescano dalla coda finché è vuota o il giro è chiuso. Se un lavoratore trova la coda vuota mentre l'altro sta ancora producendo figli, esce, e i figli li esegue l'altro: la concorrenza scende a 1, il limite di 2 resta rispettato.
- **Poche scritture del file (R11).** `queryPersistence.ts` riceve `holdQueryPersistence()`, che restituisce una funzione `release` idempotente. Mentre c'è almeno una sospensione attiva, gli eventi della `QueryCache` non programmano scritture ma segnano `writeDeferred`. Al rilascio dell'ultima sospensione, se c'era almeno un evento, si programma una sola scrittura con il ritardo solito di 1000 ms. La scrittura immediata su `visibilitychange` → `hidden` resta, perché protegge dalla chiusura dal multitasking. Il giro prende la sospensione all'inizio e la rilascia nel `finally`, dopo la pulizia.
- **Pulizia (R10).** `pruneStaleQueries(queryClient, keepHashes, now)` rimuove le query che soddisfano tutte e tre le condizioni:
  1. la chiave è di una famiglia con data o identificativo, verificata con `isPrunableKey`;
  2. non hanno osservatori e il loro `queryHash` non è in `keepHashes` (gli hash delle chiavi del giro, compresi i dettagli saltati perché già in cache);
  3. `dataUpdatedAt < now - 14 giorni`.

  Si rimuove con `queryClient.getQueryCache().remove(query)`. `["gym","workout",id]` è rimovibile solo se `typeof id === "number"`, quindi `["gym","workout","active"]` non è mai toccata. La pulizia si fa solo a fine di un giro completato.
- **Scheduler, trigger e throttle (R5, R6).**
  - **Stato.** Lo stato è a livello di modulo in `prefetchScheduler.ts`: `startedAt` (impostato da `startPrefetch`), `lastCompletedAt: number | null` e `phase` (`"idle" | "scheduled" | "running"`). Il timestamp dell'ultimo giro sta solo in memoria: un nuovo processo, cioè un'apertura a freddo, parte da `null` e quindi fa sempre un giro, come chiede la spec, senza scrivere nulla su disco.
  - **Condizioni (`canPrefetch`).** Il giro può partire solo se valgono tutte:
    - `isNative()`;
    - `getToken() !== null`;
    - `!isOffline()` e `onlineManager.isOnline()`;
    - `["me"]` ha dati non `null` con `dataUpdatedAt >= startedAt`, cioè `/auth/me` ha risposto in questa esecuzione;
    - `phase === "idle"`;
    - `lastCompletedAt === null` oppure `Date.now() - lastCompletedAt >= 15 minuti`.
  - **Trigger.**
    - evento `updated` con `action.type === "success"` sulla query `["me"]`: copre l'apertura a freddo e il ritorno della rete dopo un avvio offline;
    - `visibilitychange` → `visible`;
    - il listener di `subscribeConnectivity` quando `isOffline()` torna falso.
  - **`["me"]` già fresca all'avvio.** Se l'app viene riaperta entro i 5 minuti di `staleTime`, `["me"]` ripristinata è fresca e `/auth/me` non parte. Per questo `startPrefetch`, dopo l'attesa in idle, controlla: se `["me"]` ha `dataUpdatedAt < startedAt`, `fetchStatus` `idle`, il token c'è e la rete è online, chiama `invalidateQueries({ queryKey: ["me"], exact: true })`. La risposta riuscita fa poi scattare il primo trigger.
  - **Esito.** Solo un giro con esito `"completed"` aggiorna `lastCompletedAt`. Un giro `"aborted"` lascia il prossimo trigger libero di ripartire.
- **Idle (R11).** `scheduleIdle(cb)`: se `typeof window.requestIdleCallback === "function"` usa `requestIdleCallback(cb, { timeout: 5000 })`, altrimenti `setTimeout(cb, 2000)`. WKWebView potrebbe non avere `requestIdleCallback`, e jsdom non ce l'ha, quindi nei test vale il ripiego a 2000 ms. Il callback ricontrolla `canPrefetch` prima di partire. `startPrefetch` è chiamato da un `useEffect`, quindi sempre dopo il primo render.
- **Peso del file (R14).** `getPersistedCacheInfo()` in `queryPersistence.ts` usa `Filesystem.stat({ path: CACHE_PATH, directory: Directory.Library })`, che restituisce `size` in byte e `mtime` in millisecondi, come da `@capacitor/filesystem` 7, `FileInfo`. Restituisce `{ sizeBytes, savedAt }`, oppure `null` sul web o in caso d'errore. Non si legge il file intero.
- **Messaggio offline (R12).** `useOfflineUnavailable(query)` in `web/src/lib/useOfflineUnavailable.ts` accetta un oggetto con `data?`, `isPlaceholderData?` e `fetchStatus?`, così funziona anche con i mock parziali dei test esistenti. Legge `isOffline` con `useSyncExternalStore(subscribeConnectivity, isOffline)`, chiamato sempre, per le regole degli hook. Restituisce `isNative() && offline && (query.data === undefined || query.isPlaceholderData === true) && (query.fetchStatus === "paused" || query.fetchStatus === "fetching")`. Con `fetchStatus` assente, cioè nei mock dei test esistenti, il risultato è `false`. `OfflineUnavailable` in `web/src/components/OfflineUnavailable.tsx` mostra il titolo "Non disponibile offline" e la riga "Aprila con la rete per averla anche offline." La prop `compact` serve per le sezioni dentro una card.
- **Indicatore (R1, R2).** `OfflineIndicator` in `web/src/components/OfflineIndicator.tsx` riprende la logica di `OfflineBar`: `useSyncExternalStore` su connettività e `QueryCache`, ora più vecchia con `["me"]` esclusa salvo che sia l'unica. Non rende nulla sul web, online o senza query con dati. Rende un `<button>` 28x44 px (`h-11 w-7`) con `aria-label` uguale al testo e, dentro, un puntino ambra di 10 px (`h-2.5 w-2.5 rounded-full bg-amber-500`). Il tocco apre un fumetto `role="status"`, posizionato in assoluto sotto il puntino, che si chiude al secondo tocco o dopo 4000 ms. La prop `className` permette al chiamante di posizionarlo. Il formato dell'ora va in `web/src/lib/offlineTime.ts` (`offlineTimeParts(updatedAt, now)`), condiviso con la riga di Impostazioni. La ripresa della connessione esce dall'indicatore e va in `NativeOfflineServices`, montato una volta in `App.tsx`, così resta attiva anche nelle pagine senza puntino (R3).
- **Posizione del puntino (decisione dell'utente).**
  - `ModeSwitch`, con il permesso palestra: dentro un wrapper `relative` attorno all'interruttore, posizionato `absolute left-full top-1/2 -translate-y-1/2 ml-1`. Sta nello spazio libero tra interruttore e ingranaggio e non sposta nulla.
  - `ModeSwitch`, senza permesso palestra: nel flusso, al centro della riga, che è vuota.
  - `SettingsPage`, se l'utente non ha la palestra (`ModeSwitch` non rende nulla su `/settings`): nel flusso, accanto al titolo "Impostazioni".
  - `WorkoutDetailPage`: accanto al titolo, in assoluto rispetto a un wrapper `relative min-w-0`.
  - `WorkoutPage`: accanto al tempo trascorso, nello stesso modo.

  `TemplateEditorPage` e `AdminUsersPage` non hanno il puntino: sono schermate di scrittura o di amministrazione, fuori dall'elenco deciso con l'utente.
- **Tempi dei test.** `cd web && npm test` dura circa 2 minuti e va lanciato in background. Per ogni task si verifica prima con `npx vitest run <file>`. I test nativi usano `createQueryClient(true)` con `queryClient.mount()` e `unmount()`, `isNative` mockato con `vi.mock("<percorso>/native/platform")`, `@capacitor/preferences` e `@capacitor/filesystem` mockati, e `resetConnectivityForTests()` in `afterEach`, come in `web/src/components/OfflineBar.test.tsx` e `web/src/auth/AuthGuard.native.test.tsx`.
- **Test protetti.** Non si modificano i test elencati in C12, C20, C21, C22, C23, C24, C25 e C27, né `web/src/auth/AuthContext.restAlerts.test.tsx`. Unica eccezione ammessa da C12: `web/src/pages/gym/WorkoutPage.offline.test.tsx`. `web/src/components/OfflineBar.test.tsx` viene cancellato insieme al componente, e i suoi casi passano in `OfflineIndicator.test.tsx` (C26).

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Test di caratterizzazione: sezione peso e sessioni di Account

- Copre: C12, C28
- Rischio: basso
- File:
  - `web/src/components/stats/WeightSection.test.tsx` (nuovo)
  - `web/src/pages/AccountPage.test.tsx` (nuovo)
- Passi:
  1. **`WeightSection.test.tsx`.** Mocka `../../api/weights` (`useWeightHistory`, `useDeleteWeight`) con oggetti parziali, come fa `web/src/components/StreakCard.test.tsx` con `useStreak`. Casi:
     - `isLoading` → "Caricamento...";
     - `isError` → "Impossibile caricare il peso.";
     - dati senza pesate → "Nessuna pesata nel periodo";
     - una pesata → la riga con "kg";
     - `enabled={false}` → nessun contenuto.
  2. **`AccountPage.test.tsx`.**
     - Mocka `../auth/AuthContext`: `useMe` restituisce un `Me`, `useLogout` restituisce `vi.fn()`, `useHasPermission` restituisce false.
     - Mocka `../components/ModeSwitch` (`default: () => null`) e `../components/McpConnectionsSection` (`default: () => null`).
     - Mocka `../api/auth` con `listSessions`, `revokeSession`, `changePassword` e `regenerateRecoveryCodes`.
     - Renderizza dentro `QueryClientProvider` (un `new QueryClient({ defaultOptions: { queries: { retry: false } } })`) e `MemoryRouter`.

     Casi della sezione "Sessioni attive":
     - `listSessions` in sospeso → "Caricamento...";
     - rifiutata → "Impossibile caricare le sessioni.";
     - una sessione con `current: true` → "Questa sessione".
  3. Non modificare codice di produzione.
- Verifica: `cd web && npx vitest run src/components/stats/WeightSection.test.tsx src/pages/AccountPage.test.tsx`, risultato atteso: tutti verdi sul codice attuale.

### [x] T2. Test di caratterizzazione: palestra (modelli, esercizi, progressione)

- Copre: C12, C28
- Rischio: basso
- File:
  - `web/src/pages/gym/GymStartPage.test.tsx` (nuovo)
  - `web/src/components/gym/TemplatePreviewSheet.test.tsx` (nuovo)
  - `web/src/components/gym/ExerciseList.test.tsx` (nuovo)
  - `web/src/components/gym/ExerciseDetailSheet.test.tsx` (nuovo)
  - `web/src/components/stats/ExerciseProgressSection.test.tsx` (nuovo)
- Passi:
  1. Per mockare i moduli segui `web/src/pages/gym/GymStatsPage.test.tsx`: `vi.mock("../../api/gym", async () => ({ ...actual, useX: vi.fn() }))`, `ModeSwitch` mockato a `null` e oggetti di query parziali.
  2. **`GymStartPage.test.tsx`** (mocka `useTemplates`, `useActiveWorkout` e tutte le mutazioni usate dalla pagina, con `{ mutate: vi.fn(), isPending: false }`). Casi:
     - modelli in caricamento → "Caricamento...";
     - errore → "Errore nel caricamento dei modelli.";
     - elenco vuoto → "Nessun modello. Crea il primo con \"+ Modello\".";
     - un modello → il suo nome;
     - `useActiveWorkout` con dati → pulsante "Riprendi allenamento".
  3. **`TemplatePreviewSheet.test.tsx`** (mocka `useTemplate`). Casi:
     - caricamento → "Caricamento..." e "Inizia allenamento" disabilitato;
     - dati → il nome dell'esercizio.
  4. **`ExerciseList.test.tsx`** (passa `query` come oggetto parziale). Casi:
     - `isLoading` → "Caricamento...";
     - `isError` → "Errore nel caricamento.";
     - nessuna voce → "Nessun esercizio trovato.";
     - due voci → i due nomi.
  5. **`ExerciseDetailSheet.test.tsx`** (mocka `useExercise` e `useArchiveExercise`). Casi:
     - caricamento → "Caricamento...";
     - errore → "Errore nel caricamento.";
     - dati → "Attrezzo".
  6. **`ExerciseProgressSection.test.tsx`** (mocka `usePerformedExercises` e `useExerciseProgress`, dentro `MemoryRouter`). Casi:
     - esercizi in caricamento senza dati → "Caricamento esercizi...";
     - errore → "Impossibile caricare gli esercizi.";
     - elenco vuoto → "Completa un allenamento per vedere i progressi";
     - progressione in caricamento → "Caricamento progressione...".
  7. Non modificare codice di produzione.
- Verifica: `cd web && npx vitest run src/pages/gym/GymStartPage.test.tsx src/components/gym/TemplatePreviewSheet.test.tsx src/components/gym/ExerciseList.test.tsx src/components/gym/ExerciseDetailSheet.test.tsx src/components/stats/ExerciseProgressSection.test.tsx`, risultato atteso: tutti verdi sul codice attuale.

### [x] T3. Chiavi e funzioni di lettura esportate dai moduli API

- Copre: C3 (prerequisito), C12, C20, C28
- Rischio: alto
- File:
  - `web/src/api/queries.ts` (modifica)
  - `web/src/api/weights.ts` (modifica)
  - `web/src/api/savedWeeks.ts` (modifica)
  - `web/src/api/gym.ts` (modifica)
  - `web/src/api/fetchers.test.ts` (nuovo)
- Passi:
  1. **`queries.ts`.**
     - Esporta `diaryKeys = { day: (date) => ["diary","day",date] as const, week: (start) => ["diary","week",start] as const, range: (start, end) => ["diary","range",start,end] as const, goals: ["goals"] as const, streak: ["streak"] as const }`, che sostituisce la funzione privata `dayDiaryQueryKey`.
     - Esporta le funzioni `fetchDayDiary(date)`, `fetchWeekDiary(start)`, `fetchDiaryRange(start, end)`, `fetchGoal()` (con la conversione 404 → `null` presa da `useGoal`) e `fetchStreak()`.
     - `useDayDiary`, `useWeekDiary`, `useDiaryRange`, `useGoal` e `useStreak` usano queste chiavi e funzioni. Le URL restano identiche.
  2. **`weights.ts`.** Esporta `fetchTodayWeight()` (204/`undefined` → `null`) e `fetchWeightHistory(start, end)`, usate dai due hook.
  3. **`savedWeeks.ts`.** Esporta `fetchSavedWeeks()` e `fetchSavedWeek(id)`. `useSavedWeek` mantiene il suo `retry`.
  4. **`gym.ts`.**
     - Esporta `fetchTemplates()`, `fetchTemplate(id)`, `fetchExercises(filters)` (usa `exercisesPath`), `fetchHistoryPage(before: string | null)` (stessa URL di `useHistory`: `/workouts?limit=20` più `&before=` se presente), `fetchWorkout(id)`, `fetchGymCount()`, `fetchGymStats(start, end)`, `fetchPerformedExercises()` e `fetchExerciseProgress(id, start, end)`.
     - Gli hook corrispondenti le usano: `useHistory` con `queryFn: ({ pageParam }) => fetchHistoryPage(pageParam)`.
     - `gymKeys` resta com'è.
  5. Solo dichiarazioni di funzione: nessun nuovo `const` calcolato chiamando `client` a livello di modulo (ciclo di import).
  6. **`fetchers.test.ts`** (client web, `fetch` stubbato con risposte minimali come in `OfflineBar.test.tsx`). Per ogni funzione verifica la URL esatta (`/api/...`). Verifica inoltre che `fetchGoal()` con 404 risolva `null` e che `fetchTodayWeight()` con 204 risolva `null`.
- Verifica: `cd web && npx vitest run src/api/ src/pages/ src/components/ && npx tsc -b`, risultato atteso: verdi, nessun errore di tipo. Poi `cd web && npm test`: tutti verdi.

### [x] T4. Persistenza: sospensione delle scritture e informazioni sul file

- Copre: C10, C13 (funzione), C22, C23, C28
- Rischio: alto
- File: `web/src/native/queryPersistence.ts` (modifica), `web/src/native/queryPersistence.hold.test.ts` (nuovo)
- Passi:
  1. **Variabili di modulo.** Aggiungi `let holds = 0`, `let writeDeferred = false` e `let scheduleWriteRef: (() => void) | null = null`.
  2. **`startQueryPersistence`.**
     - Assegna `scheduleWriteRef = scheduleWrite`, e azzeralo nella cleanup.
     - In `scheduleWrite`, se `holds > 0`, imposta `writeDeferred = true` ed esci senza timer.
     - La scrittura su `visibilitychange` → `hidden` resta immediata.
  3. **`holdQueryPersistence(): () => void`.**
     - Sul web restituisce una funzione vuota.
     - Altrimenti `holds++` e restituisce una funzione `release` idempotente (un flag locale), che fa `holds--`.
     - Se dopo il rilascio `holds === 0` e `writeDeferred` è vero, `release` azzera `writeDeferred` e chiama `scheduleWriteRef?.()`.
  4. **`clearPersistedQueryCache`.** Azzera anche `writeDeferred`.
  5. **`getPersistedCacheInfo(): Promise<{ sizeBytes: number; savedAt: number } | null>`.**
     - Sul web restituisce `null`.
     - Altrimenti `Filesystem.stat({ path: CACHE_PATH, directory: Directory.Library })` e restituisce `{ sizeBytes: size, savedAt: mtime }`.
     - Su qualunque errore restituisce `null`.
  6. **`queryPersistence.hold.test.ts`.** Prendi lo schema di mock da `queryPersistence.test.ts`, che non va modificato. Casi:
     - con una sospensione attiva, 5 `setQueryData` e `advanceTimersByTimeAsync(5000)` → `writeFile` non chiamato; dopo `release()` e 1000 ms → una sola scrittura;
     - `release` chiamata due volte non porta `holds` sotto zero;
     - con una sospensione attiva, `visibilitychange` → `hidden` scrive subito;
     - senza token, al rilascio non si scrive (C23);
     - `getPersistedCacheInfo` con `stat` mockato (`size: 430080`, `mtime: 123`) → `{ sizeBytes: 430080, savedAt: 123 }`; con `stat` che rifiuta → `null`; sul web → `null` senza chiamare `Filesystem`.
- Verifica: `cd web && npx vitest run src/native/ && npx tsc -b`, risultato atteso: verdi (compresi `queryPersistence.test.ts` e `queryPersistence.restore.native.test.tsx` invariati). Poi `cd web && npm test`.

### [x] T5. Pulizia delle query vecchie

- Copre: C9, C28
- Rischio: alto
- File: `web/src/native/cachePrune.ts` (nuovo), `web/src/native/cachePrune.test.ts` (nuovo)
- Passi:
  1. **Costante.** Esporta `PRUNE_AGE_MS = 14 * 24 * 60 * 60 * 1000`.
  2. **`isPrunableKey(queryKey: readonly unknown[]): boolean`.** Vero per:
     - `["diary","day",*]`, `["diary","week",*]`, `["diary","range",*,*]`;
     - `["weight","range",*,*]`;
     - `["gym","stats","range",*,*]`, `["gym","stats","progress",*,*,*]`;
     - `["gym","workout",id]` solo se `typeof id === "number"`;
     - `["gym","template",id]`;
     - `["saved-weeks","detail",id]`.

     Falso per tutto il resto, compresi `["gym","workout","active"]`, `["diary","day"]` senza data, `["me"]`, `["goals"]` e `["gym","history"]`.
  3. **`pruneStaleQueries(queryClient, keepHashes: ReadonlySet<string>, now: number): number`.** Scorre `getQueryCache().getAll()` e rimuove con `getQueryCache().remove(query)` le query con queste tre condizioni:
     - `isPrunableKey`;
     - `getObserversCount() === 0` e `queryHash` non in `keepHashes`;
     - `state.dataUpdatedAt < now - PRUNE_AGE_MS`.

     Restituisce il numero di query rimosse.
  4. **Test** (con `createQueryClient(true)`, dati inseriti con `setQueryData(key, data, { updatedAt })`). Casi:
     - giorno di 20 giorni prima rimosso, giorno di 3 giorni prima tenuto;
     - query vecchia con un observer (`new QueryObserver(queryClient, { queryKey, enabled: false }).subscribe(() => {})`) tenuta;
     - query vecchia il cui hash (`hashKey(key)` da `@tanstack/react-query`) è in `keepHashes` tenuta;
     - `["gym","workout","active"]` vecchia tenuta;
     - `["gym","workout",7]` vecchia rimossa;
     - `["goals"]` e `["me"]` vecchie tenute;
     - tabella di casi per `isPrunableKey`.
- Verifica: `cd web && npx vitest run src/native/cachePrune.test.ts && npx tsc -b`, risultato atteso: verdi.

### [x] T6. Giro di precarico: elenco delle query, permessi, tetti, fine giro

- Copre: C3, C5 (permessi), C8 (parte del giro), C9 (dettagli saltati e pulizia a fine giro), C10 (scritture), C28
- Rischio: alto
- File:
  - `web/src/native/prefetch.ts` (nuovo)
  - `web/src/native/prefetch.test.ts` (nuovo)
  - `web/src/test/prefetchFixtures.ts` (nuovo)
- Passi:
  1. **Costanti in `prefetch.ts`.** `MAX_TEMPLATE_DETAILS = 30`, `MAX_SAVED_WEEK_DETAILS = 10` e `MAX_CONCURRENT = 2` (usata in T7; qui i compiti girano in sequenza). `export type PrefetchOutcome = "completed" | "aborted"`.
  2. **`runPrefetchRound(queryClient): Promise<PrefetchOutcome>`, inizio giro.**
     - Legge `me = queryClient.getQueryData<Me | null>(["me"])`. Se è assente o `null` restituisce `"aborted"`.
     - `canGym = me.role === "admin" || me.permissions.includes("workouts.use")`; `canCopy` è lo stesso con `"diary.copy"`.
     - Calcola `today = todayIso()`, `yesterday = shiftIsoDate(today, -1)` e `monday = startOfWeek(today)`. Per i periodi usa `PRESETS.map((n) => presetPeriod(n, today))`.
     - Prende `release = holdQueryPersistence()`. Nel `finally` lo rilascia, dopo la pulizia.
  3. **Compiti iniziali.** Ogni compito chiama la funzione di T3, poi `set(key, data)`, poi restituisce eventuali figli.
     - **Sempre:**
       - `diaryKeys.day(today)`, `diaryKeys.day(yesterday)`, `diaryKeys.week(monday)`;
       - `diaryKeys.goals`, `diaryKeys.streak`, `weightKeys.today`;
       - per ogni periodo, `diaryKeys.range(start, today)` e `weightKeys.range(start, today)`.
     - **Con `canGym`:**
       - `gymKeys.templates`, con figli `gymKeys.template(id)` per i primi 30 `templates` della risposta;
       - `gymKeys.exercises(EMPTY_FILTERS)`;
       - storico con `fetchHistoryPage(null)`: scrive `{ pages: [page], pageParams: [null] }` su `gymKeys.history`, salvo che la query abbia osservatori. I figli sono `gymKeys.workout(id)` per ogni voce della pagina, saltando quelle con `getQueryData(gymKeys.workout(id)) !== undefined`;
       - `gymKeys.statsCount`;
       - per ogni periodo, `gymKeys.stats(start, today)`;
       - `gymKeys.statsExercises`, con figli, se l'elenco non è vuoto, `gymKeys.progress(list[0].exercise_id, start, today)` per ogni periodo.
     - **Con `canCopy`:** `savedWeekKeys.list`, con figli `savedWeekKeys.detail(id)` per i primi 10 elementi.
  4. **`set(key, data)`.** Chiama `queryClient.setQueryData(key, data)` e aggiunge `hashKey(key)` a `roundHashes`. Anche le chiavi dei dettagli saltati vanno in `roundHashes`. Il giro non chiama mai `invalidateQueries`, salvo quella su `["me"]` di T7, e non usa mai `gymKeys.active`.
  5. **Esecuzione.** In questo task i compiti girano in sequenza. Un errore qualsiasi di un compito viene ignorato (`try/catch`) e il giro prosegue; T7 affina questi esiti.
  6. **Fine giro.** Chiama `pruneStaleQueries(queryClient, roundHashes, Date.now())` e restituisce `"completed"`.
  7. **`prefetchFixtures.ts`.** Esporta:
     - `meWith(permissions, role = "user")`;
     - fixture valide per ogni endpoint: 25 allenamenti divisi in due pagine (la prima di 20 con `next_before`), 3 modelli, 12 settimane salvate, 2 esercizi eseguiti, catalogo esercizi;
     - `routeFetch(overrides?)`, che restituisce un `fetch` mock: risolve la URL (togliendo `/api`) sulla fixture, con risposta minimale `{ ok, status, json }` e 204 per `/weights/today`;
     - un registro delle URL chiamate.
  8. **`prefetch.test.ts`.**
     - **Setup:** `isNative` mockato true, `@capacitor/preferences` e `@capacitor/filesystem` mockati, `setToken("tok-a")`, `createQueryClient(true)` con `mount()`, `vi.setSystemTime(new Date(2026, 9, 13, 10, 0))`.
     - **C3:** con `meWith(["workouts.use","diary.copy"])`, dopo il giro:
       - le chiavi in cache (`getAll().map(q => q.queryKey)`, escluso `["me"]`) sono esattamente quelle attese: 2 giorni, 1 settimana, `goals`, `streak`, `weight/today`, 3+3+3 periodi, `templates` e 3 dettagli, `exercises`, `history`, 20 dettagli di allenamento, `count`, `stats/exercises` e 3 progressioni, `saved-weeks/list` e 10 dettagli;
       - le URL nel registro corrispondono a R4;
       - nessuna URL contiene `/workouts/active`, `/foods`, `/admin`, `/auth/sessions` o `/exercises/` seguito da un numero;
       - con `/goals` che risponde 404, `getQueryData(["goals"])` è `null`;
       - `getQueryData(gymKeys.history)` ha `pages[0].items.length === 20` e `pageParams` `[null]`.
     - **C5:** con `meWith([])` nessuna URL palestra né `/saved-weeks`; con solo `workouts.use` nessuna URL `/saved-weeks`.
     - **C9:**
       - con `setQueryData(gymKeys.workout(7), …)` prima del giro e l'allenamento 7 nella prima pagina, `/workouts/7` non viene chiamato e la query resta;
       - una `["diary","day","2026-09-01"]` aggiornata 20 giorni prima viene rimossa a fine giro;
       - `["gym","workout","active"]` impostata prima resta identica.
     - **C8 (parte del giro):** con `vi.spyOn(queryClient, "invalidateQueries")`, nessuna chiamata con un `queryKey` che inizi con `["gym","workout"]`; `getQueryData(gymKeys.active)` resta `undefined` se non impostata.
     - **C10 (scritture):** con `startQueryPersistence(queryClient)` attivo e fake timers, dopo il giro e `advanceTimersByTimeAsync(1000)` → `Filesystem.writeFile` chiamato al più 2 volte (atteso 1).
- Verifica: `cd web && npx vitest run src/native/prefetch.test.ts && npx tsc -b`, risultato atteso: verdi. Poi `cd web && npm test`.

### [x] T7. Giro di precarico: errori, sessione e concorrenza

- Copre: C6, C7, C10 (concorrenza), C21, C22, C28
- Rischio: alto
- File: `web/src/native/prefetch.ts` (modifica), `web/src/native/prefetch.errors.test.ts` (nuovo)
- Passi:
  1. **Esecuzione con la coda.** Sostituisci l'esecuzione in sequenza con la coda e due lavoratori (`MAX_CONCURRENT`).
     - Ogni lavoratore, finché `!aborted` e la coda non è vuota, prende un compito, lo esegue e mette in coda i figli restituiti.
     - Il giro attende tutti i lavoratori con `Promise.all`.
  2. **Legame con la sessione.** All'inizio `const token = getToken()`. Se è `null`, restituisci `"aborted"` senza richieste. La funzione `alive()` restituisce `!aborted && getToken() === token`:
     - prima di avviare un compito, se `!alive()` imposta `aborted = true` e non lo avvia;
     - in `set`, se `!alive()` non scrive e imposta `aborted = true`.
  3. **Esiti di un compito.**
     - `NetworkError` (da `../api/client`): `aborted = true`, senza nient'altro, perché il client ha già segnalato la rete assente.
     - `ApiError` con status 401: `aborted = true`, poi `queryClient.setQueryData(["me"], null)` e `void queryClient.invalidateQueries({ queryKey: ["me"] })`, come nel `QueryCache.onError` di `web/src/lib/queryClient.ts`.
     - Qualsiasi altro errore: ignorato, il giro prosegue. Nessuna scrittura in cache per quel compito.
  4. **Fine giro.** Con `aborted` vero: niente pulizia, rilascio della sospensione, esito `"aborted"`. Altrimenti pulizia ed esito `"completed"`.
  5. **`prefetch.errors.test.ts`** (stesso setup di T6, con `routeFetch` e sovrascritture per URL). Casi:
     - **C6, rete:** la terza URL chiamata rifiuta con `TypeError("Failed to fetch")`. Nessuna URL successiva, esito `"aborted"`, `runPrefetchRound` non lancia, nessuna query con `fetchStatus` `paused` né `status` `error`, `isOffline()` vero.
     - **C6, 500:** `setQueryData(["streak"], { current: 3, best: 5 })` prima, poi `/stats/streak` risponde 500. Le altre chiavi ci sono, `["streak"]` ha ancora `{ current: 3, best: 5 }` con `status` `success`. Una `StreakCard` renderizzata subito dopo dentro `QueryClientProvider` mostra "3 giorni di fila" e non "Impossibile caricare la serie.".
     - **C6, una volta:** ogni URL compare al più una volta nel registro.
     - **C7, 401:** `/stats/streak` risponde 401 `{ detail: "unauthorized" }`. `getToken()` è `null`, `Filesystem.deleteFile` è chiamato, `getQueryData(["me"])` è `null`, nessuna URL parte dopo quella, esito `"aborted"`.
     - **C7, cambio token:** il `fetch` di `/goals` chiama `setToken("tok-b")` prima di rispondere. Nessuna richiesta successiva ha `Authorization: Bearer tok-a`, `getQueryData(["goals"])` resta `undefined`, esito `"aborted"`.
     - **C10, concorrenza:** un `fetch` che conta le richieste in volo e risolve dopo `setTimeout(…, 5)` con timer reali. Il massimo osservato è `<= 2` e il giro arriva a `"completed"`.
     - **C22:** con 502 e risposta non JSON su una URL, `getToken()` resta `"tok-a"` e `deleteFile` non è chiamato.
- Verifica: `cd web && npx vitest run src/native/prefetch.test.ts src/native/prefetch.errors.test.ts src/api/client.errors.native.test.ts && npx tsc -b`, risultato atteso: verdi. Poi `cd web && npm test`.

### [x] T8. Scheduler del precarico: trigger, condizioni, throttle, idle

- Copre: C4, C5, C10 (avvio), C20 (nessun precarico sul web), C28
- Rischio: alto
- File: `web/src/native/prefetchScheduler.ts` (nuovo), `web/src/native/prefetchScheduler.test.ts` (nuovo)
- Passi:
  1. **Costanti e stato.** `PREFETCH_INTERVAL_MS = 15 * 60_000`, `IDLE_FALLBACK_MS = 2000`, `IDLE_TIMEOUT_MS = 5000`. Stato di modulo: `startedAt = 0`, `lastCompletedAt: number | null = null`, `phase: "idle" | "scheduled" | "running" = "idle"`.
  2. **`scheduleIdle(cb)`.** Usa `window.requestIdleCallback(cb, { timeout: IDLE_TIMEOUT_MS })` se esiste, altrimenti `setTimeout(cb, IDLE_FALLBACK_MS)`. Restituisce una funzione di annullamento.
  3. **`canPrefetch(queryClient)`.** Le condizioni elencate nell'Approccio. Per `["me"]` legge `queryClient.getQueryCache().find({ queryKey: ["me"], exact: true })`.
  4. **`requestPrefetch(queryClient)`.**
     - Se `!canPrefetch`, esce.
     - Altrimenti `phase = "scheduled"` e `scheduleIdle(...)`. Nel callback:
       1. se `!canPrefetch` ignorando la fase, torna a `"idle"`;
       2. altrimenti `phase = "running"` e `runPrefetchRound(queryClient)` (da `./prefetch`);
       3. a esito `"completed"`, `lastCompletedAt = Date.now()`;
       4. sempre `phase = "idle"` alla fine, anche su errore.
  5. **`startPrefetch(queryClient): () => void`.**
     - Sul web restituisce una funzione vuota.
     - Altrimenti `startedAt = Date.now()` e registra i tre trigger:
       - `queryClient.getQueryCache().subscribe(event)`: se `event.type === "updated"`, `event.action.type === "success"` e la chiave è `["me"]`, chiama `requestPrefetch`;
       - `visibilitychange` con `visible`: chiama `requestPrefetch`;
       - `subscribeConnectivity`: se `!isOffline()`, chiama `requestPrefetch`.
     - Programma con `scheduleIdle` il controllo della `["me"]` fresca: se `["me"]` ha `dataUpdatedAt < startedAt`, `fetchStatus === "idle"`, il token c'è ed è online, chiama `void queryClient.invalidateQueries({ queryKey: ["me"], exact: true })`.
     - Chiama anche `requestPrefetch` una volta.
     - Restituisce la cleanup, che toglie i trigger e annulla le attese in idle.
  6. **`resetPrefetchSchedulerForTests()`.** Riporta lo stato iniziale.
  7. **Test** (`./prefetch` mockato con `runPrefetchRound: vi.fn().mockResolvedValue("completed")`, `isNative` mockato, Preferences mockato con token, connettività reale, fake timers, `createQueryClient(true)`). Casi:
     - **C10:** dopo `startPrefetch`, con `["me"]` ripristinata con `updatedAt` precedente all'avvio (`setQueryData(["me"], me, { updatedAt: Date.now() - 60_000 })` prima di `startPrefetch`), `runPrefetchRound` non viene chiamato. Dopo un `setQueryData(["me"], me)` fresco e 2000 ms, viene chiamato una volta, non prima dei 2000 ms. L'`invalidateQueries` di `["me"]` è chiamato dopo l'attesa in idle.
     - **C4:**
       - dopo un giro completato, `visibilitychange` → `visible` a +5 minuti non chiama `runPrefetchRound`; a +16 minuti sì, dopo 2000 ms;
       - con `runPrefetchRound` in sospeso (promise controllata), un secondo trigger non lo richiama;
       - dato un avvio con `reportNetworkFailure()` prima del `["me"]` fresco, nessun giro; dopo `reportNetworkSuccess()` il giro parte;
       - un giro `"aborted"` non aggiorna `lastCompletedAt`: il trigger successivo entro 15 minuti fa partire un giro.
     - **C5:** nessuna chiamata a `runPrefetchRound` nei casi `isNative` false (e nessun listener registrato), token `null`, `isOffline()` vero e `["me"]` `null`.
     - In `afterEach`: cleanup, `resetPrefetchSchedulerForTests()` e `resetConnectivityForTests()`.
- Verifica: `cd web && npx vitest run src/native/prefetchScheduler.test.ts && npx tsc -b`, risultato atteso: verdi.

### [x] T9. Hook e componente "Non disponibile offline"

- Copre: C11 (hook), C20, C28
- Rischio: alto
- File:
  - `web/src/lib/useOfflineUnavailable.ts` (nuovo)
  - `web/src/lib/useOfflineUnavailable.test.tsx` (nuovo)
  - `web/src/components/OfflineUnavailable.tsx` (nuovo)
- Passi:
  1. **Hook `useOfflineUnavailable(query: { data?: unknown; isPlaceholderData?: boolean; fetchStatus?: string }): boolean`.** Implementalo come nell'Approccio. `useSyncExternalStore(subscribeConnectivity, isOffline)` va chiamato sempre, anche sul web, per le regole degli hook.
  2. **Componente `OfflineUnavailable({ compact = false })`.**
     - Con `compact` falso: card `card px-4 py-6 text-center`, titolo `text-sm font-semibold text-slate-700` "Non disponibile offline" e riga `text-xs text-slate-500` "Aprila con la rete per averla anche offline.".
     - Con `compact` vero: solo un `<p>` piccolo con il titolo e la riga, senza card.
     - In entrambi i casi la radice ha `data-testid="offline-unavailable"`.
  3. **Test** con `createQueryClient(true)`, `mount()`, `isNative` mockato e un componente di prova che usa `useQuery` più l'hook. Casi:
     - `fetch` che rifiuta, quindi query in pausa senza dati → `true`;
     - dopo `retryConnection()`, con la query di nuovo `fetching` e `isOffline()` ancora vero → ancora `true`;
     - query con dati in pausa → `false`;
     - query disabilitata (`enabled: false`) offline → `false`;
     - query con `placeholderData` offline → `true`;
     - con la rete presente (`isOffline()` falso), query in caricamento → `false`;
     - `isNative` false → `false`;
     - oggetto senza `fetchStatus` → `false`.
- Verifica: `cd web && npx vitest run src/lib/useOfflineUnavailable.test.tsx && npx tsc -b`, risultato atteso: verdi.

### [x] T10. Messaggio offline: diario, settimana, settimane salvate

- Copre: C11, C12, C28
- Rischio: alto
- File:
  - `web/src/pages/DayPage.tsx` (modifica)
  - `web/src/pages/WeekPage.tsx` (modifica)
  - `web/src/pages/SavedWeeksPage.tsx` (modifica)
  - `web/src/pages/SavedWeekDetailPage.tsx` (modifica)
  - `web/src/test/offlineQuery.ts` (nuovo)
  - `web/src/pages/offline.diary.native.test.tsx` (nuovo)
- Passi:
  1. **`web/src/test/offlineQuery.ts`.** Esporta due oggetti da usare come ritorno dei mock degli hook:
     - `pausedQuery()`: `{ data: undefined, isLoading: false, isError: false, isPlaceholderData: false, fetchStatus: "paused", status: "pending" }`;
     - `retryingQuery()`: come sopra, ma con `isLoading: true` e `fetchStatus: "fetching"`.
  2. In ogni pagina tieni l'oggetto query intero (per esempio `const diary = useDayDiary(date)`) e calcola `const unavailable = useOfflineUnavailable(diary)`. Se `unavailable`, rendi `<OfflineUnavailable />` al posto dei blocchi "Caricamento...", errore e vuoto della query. Header, frecce, link e il resto della pagina restano.
     - **`DayPage`:** blocchi `isLoading` e `isError` del diario.
     - **`WeekPage`:** blocchi `isLoading` e `isError` della settimana.
     - **`SavedWeeksPage`:** caricamento, errore ed elenco vuoto.
     - **`SavedWeekDetailPage`:** caricamento ed errore.
  3. **`offline.diary.native.test.tsx`.** Mocka `../native/platform` (`isNative: () => true`) e gli hook delle quattro pagine, ricopiando i mock da `DayPage.test.tsx`, `WeekPage.test.tsx`, `SavedWeeksPage.test.tsx` e `SavedWeekDetailPage.test.tsx`. Chiama `reportNetworkFailure()` in `beforeEach` e `resetConnectivityForTests()` in `afterEach`. Per ogni pagina:
     - con `pausedQuery()` compare "Non disponibile offline" e non compaiono "Caricamento...", "Errore nel caricamento..." né "Nessuna settimana salvata.";
     - con `retryingQuery()` il messaggio resta e "Caricamento..." non compare;
     - con `isOffline()` falso (`reportNetworkSuccess()`) e `pausedQuery()` il messaggio non c'è.
  4. I test esistenti delle quattro pagine non si modificano.
- Verifica: `cd web && npx vitest run src/pages/offline.diary.native.test.tsx src/pages/DayPage.test.tsx src/pages/WeekPage.test.tsx src/pages/WeekPage.savedWeeks.test.tsx src/pages/SavedWeeksPage.test.tsx src/pages/SavedWeekDetailPage.test.tsx`, risultato atteso: verdi.

### [x] T11. Messaggio offline: statistiche dieta, serie, peso

- Copre: C11, C12, C28
- Rischio: alto
- File:
  - `web/src/pages/DietStatsPage.tsx` (modifica)
  - `web/src/components/StreakCard.tsx` (modifica)
  - `web/src/components/stats/WeightSection.tsx` (modifica)
  - `web/src/pages/offline.dietStats.native.test.tsx` (nuovo)
- Passi:
  1. **`DietStatsPage`.** Nella catena `error !== null ? null : range.isError ? … : range.isLoading ? … : grafici`, aggiungi subito dopo `error !== null` il ramo `rangeUnavailable ? <OfflineUnavailable /> :`.
  2. **`StreakCard`.** Prima del ramo `isError`, se l'hook restituisce `true` il `body` è `<OfflineUnavailable compact />`. Le badge non compaiono, perché `data` non c'è.
  3. **`WeightSection`.** Nella catena di rendering, prima di `history.isError`, il ramo `<OfflineUnavailable compact />`. `enabled={false}` continua a non rendere nulla.
  4. **Test nativo** (stesso schema di T10; mocka `../api/queries` per `useDiaryRange`, `useGoal` e `useStreak`, e `../api/weights`). Casi:
     - ogni sezione in pausa mostra il proprio messaggio e non "Caricamento..." né "Nessuna pesata nel periodo";
     - **C11:** `useDiaryRange` con dati, `useStreak` in pausa → i grafici ci sono (testo di `SummaryTable` o titolo di un grafico, come in `DietStatsPage.test.tsx`) e "Non disponibile offline" compare una sola volta, dentro la card della serie;
     - con `retryingQuery()` il messaggio resta;
     - online nessun messaggio.
  5. `DietStatsPage.test.tsx`, `StreakCard.test.tsx` e `WeightSection.test.tsx` (T1) non si modificano.
- Verifica: `cd web && npx vitest run src/pages/offline.dietStats.native.test.tsx src/pages/DietStatsPage.test.tsx src/components/StreakCard.test.tsx src/components/stats/`, risultato atteso: verdi.

### [x] T12. Messaggio offline: modelli, storico, dettaglio allenamento

- Copre: C11, C12, C28
- Rischio: alto
- File:
  - `web/src/pages/gym/GymStartPage.tsx` (modifica)
  - `web/src/components/gym/TemplatePreviewSheet.tsx` (modifica)
  - `web/src/pages/gym/HistoryPage.tsx` (modifica)
  - `web/src/pages/gym/WorkoutDetailPage.tsx` (modifica)
  - `web/src/pages/gym/offline.gym.native.test.tsx` (nuovo)
- Passi:
  1. **`GymStartPage`.** `useOfflineUnavailable(templates)`. Se è vero, `<OfflineUnavailable />` sostituisce i blocchi "Caricamento..." ed errore dei modelli. Il pulsante di avvio e il titolo "Modelli" restano. Non applicare l'hook ad `active`: l'allenamento attivo non è mai in cache e il pulsante deve restare com'è.
  2. **`TemplatePreviewSheet`.** Se `useTemplate` non ha dati offline, `<OfflineUnavailable compact />` al posto di "Caricamento...". "Inizia allenamento" resta disabilitato, come oggi senza dati.
  3. **`HistoryPage`.** `useOfflineUnavailable(history)` sostituisce caricamento, errore e il riquadro "Nessun allenamento completato.".
  4. **`WorkoutDetailPage`.** `useOfflineUnavailable` sulla query `useWorkout` sostituisce "Caricamento..." e "Allenamento non trovato.". Il pulsante "‹ Storico" resta.
  5. **Test nativo** con lo schema di T10, ricopiando i mock da `HistoryPage.test.tsx`, `WorkoutDetailPage.test.tsx` e dai test di T2. Per ogni componente:
     - in pausa compare il messaggio, mentre non compaiono "Caricamento...", "Errore..." né "Nessun ...";
     - con `retryingQuery()` il messaggio resta;
     - online non compare.
  6. I test esistenti e quelli di T2 non si modificano.
- Verifica: `cd web && npx vitest run src/pages/gym/ src/components/gym/`, risultato atteso: verdi.

### [x] T13. Messaggio offline: esercizi e statistiche palestra

- Copre: C11, C12, C28
- Rischio: alto
- File:
  - `web/src/components/gym/ExerciseList.tsx` (modifica)
  - `web/src/components/gym/ExerciseDetailSheet.tsx` (modifica)
  - `web/src/pages/gym/GymStatsPage.tsx` (modifica)
  - `web/src/components/WorkoutCountCard.tsx` (modifica)
  - `web/src/components/stats/ExerciseProgressSection.tsx` (modifica)
  - `web/src/components/offline.gymStats.native.test.tsx` (nuovo)
- Passi:
  1. **`ExerciseList`.** All'inizio, se `useOfflineUnavailable(query)` è vero, restituisce `<OfflineUnavailable />`. L'hook copre anche `isPlaceholderData`, cioè il caso di un filtro attrezzo o muscolo offline.
  2. **`ExerciseDetailSheet`.** `<OfflineUnavailable compact />` al posto di "Caricamento..." ed errore quando l'hook è vero.
  3. **`GymStatsPage`.** Nella catena `error !== null ? null : stats.isError ? … : stats.isLoading || !stats.data ? …`, aggiungi dopo `error !== null` il ramo del messaggio.
  4. **`WorkoutCountCard`.** Prima di `isError`, il `body` è `<OfflineUnavailable compact />`.
  5. **`ExerciseProgressSection`.**
     - Se l'hook su `exercises` è vero, restituisce `<OfflineUnavailable />` prima dei controlli `isError` e `isLoading`.
     - Dentro la card, nel ramo della progressione (`!enabled ? null : progress.isError ? …`), aggiungi dopo `!enabled` il ramo `<OfflineUnavailable compact />` quando l'hook su `progress` è vero.
  6. **Test nativo** (schema di T10). Casi:
     - ogni componente in pausa mostra il messaggio e non mostra "Caricamento...", "Caricamento esercizi...", "Caricamento progressione..." né "Nessun esercizio trovato.";
     - **C11:** `ExerciseList` con `{ data: { items: [...], total: 2 }, isPlaceholderData: true, fetchStatus: "paused" }` offline → messaggio al posto della lista;
     - con `retryingQuery()` il messaggio resta;
     - online non compare.
  7. `GymStatsPage.test.tsx`, `WorkoutCountCard.test.tsx`, `ExercisePicker.test.tsx` e i test di T2 non si modificano.
- Verifica: `cd web && npx vitest run src/components/ src/pages/gym/`, risultato atteso: verdi.

### [x] T14. Messaggio offline: Cerca (Recenti), sessioni di Account, allenamento in corso

- Copre: C11, C12, C28
- Rischio: alto
- File:
  - `web/src/pages/SearchPage.tsx` (modifica)
  - `web/src/pages/AccountPage.tsx` (modifica)
  - `web/src/pages/gym/WorkoutPage.tsx` (modifica)
  - `web/src/pages/gym/WorkoutPage.offline.test.tsx` (modifica)
  - `web/src/pages/offline.other.native.test.tsx` (nuovo)
- Passi:
  1. **`SearchPage`.** `const recentUnavailable = useOfflineUnavailable(recentFoods) && !isSearching && tab === "recenti"`.
     - Se è vero, la lista dei risultati mostra `<OfflineUnavailable compact />` al posto del riquadro "Nessun alimento recente." (riga 233).
     - "Caricamento..." (riga 251) non compare.
     - La ricerca con testo resta com'è.
  2. **`AccountPage`.** Nella sezione "Sessioni attive", se l'hook su `sessions` è vero, `<OfflineUnavailable compact />` al posto di "Caricamento...". Il resto della pagina, compreso il logout, resta.
  3. **`WorkoutPage`.**
     - Calcola `unavailable = useOfflineUnavailable(active)` (oggetto della query `useActiveWorkout`) e mettilo prima di `if (isLoading)`.
     - Se è vero, rendi la stessa schermata di oggi con "Allenamento non disponibile offline" e il link "Vai ai modelli".
     - Il ramo `!workout` mostra solo "Nessun allenamento in corso.". Togli la variabile `offline` basata solo su `fetchStatus`.
  4. **`WorkoutPage.offline.test.tsx`.** Unica modifica ammessa da C12: nel caso nativo chiama `reportNetworkFailure()` prima del render (e `resetConnectivityForTests()` in `afterEach`). Aggiungi un caso con `isLoading: true` e `fetchStatus: "fetching"` offline, in cui il messaggio resta. Il caso web resta.
  5. **`offline.other.native.test.tsx`.**
     - `SearchPage`, con i mock ripresi da `SearchPage.test.tsx` e `useRecentFoods` in pausa → messaggio, e nessun "Nessun alimento recente.";
     - `AccountPage`, con i mock di T1 e `listSessions` mai risolta mentre si è offline: con `useQuery` reale offline la query va in pausa. Usa `createQueryClient(true)` e `reportNetworkFailure()` prima del render → il messaggio è nella sezione sessioni;
     - online, per entrambe, nessun messaggio.
- Verifica: `cd web && npx vitest run src/pages/offline.other.native.test.tsx src/pages/SearchPage.test.tsx src/pages/AccountPage.test.tsx src/pages/gym/WorkoutPage.offline.test.tsx src/pages/gym/WorkoutPage.test.tsx`, risultato atteso: verdi. Poi `cd web && npm test`.

### [x] T15. Indicatore offline al posto della barra, e servizi nativi in App

- Copre: C1, C2, C20, C26, C28
- Rischio: alto
- File:
  - `web/src/lib/offlineTime.ts` (nuovo)
  - `web/src/components/OfflineIndicator.tsx` (nuovo)
  - `web/src/components/OfflineIndicator.test.tsx` (nuovo)
  - `web/src/native/NativeOfflineServices.tsx` (nuovo)
  - `web/src/App.tsx` (modifica)
  - `web/src/components/OfflineBar.tsx` (eliminato)
  - `web/src/components/OfflineBar.test.tsx` (eliminato)
- Passi:
  1. **`offlineTime.ts`.** `offlineTimeParts(updatedAt: number, now: Date): { time: string; day: string | null }`, con `toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })`. `day` vale `toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })` se la data non è oggi, altrimenti `null`.
  2. **`OfflineIndicator({ className }: { className?: string })`.**
     - Sposta da `OfflineBar.tsx` `isMeQuery`, `oldestShownUpdatedAt` e le due `useSyncExternalStore`, senza cambiarne la logica.
     - Testo: `Offline, dati delle ${time}` se `day` è `null`, altrimenti `Offline, dati del ${day} alle ${time}`.
     - Se `!isNative()`, se si è online o senza ora, restituisce `null`.
     - Altrimenti rende `<span className={className ?? "relative inline-flex"}>` con dentro:
       - un `<button type="button" aria-label={testo} aria-expanded={open}>` (`flex h-11 w-7 items-center justify-center`) con il puntino `span` `h-2.5 w-2.5 rounded-full bg-amber-500`;
       - se `open`, un `<span role="status">` `absolute right-1/2 top-full z-50 translate-x-1/2 whitespace-nowrap rounded-lg bg-amber-100 px-2 py-1 text-xs text-amber-900 shadow` con il testo.
     - Il tocco alterna `open`. Un `useEffect` chiude dopo 4000 ms quando `open` diventa vero, con cleanup del timer.
     - Non avvia la ripresa della connessione.
  3. **`NativeOfflineServices`.** Componente senza props che rende `null`. In un `useEffect`, solo se `isNative()`, chiama `startConnectivityRecovery()` e ne restituisce la cleanup. Il precarico si aggiunge in T16.
  4. **`App.tsx`.** Sostituisci `<OfflineBar />` con `<NativeOfflineServices />`, nella stessa posizione dopo `<NativeBridge />`. L'indicatore non si monta qui: va negli header in T17.
  5. **`OfflineIndicator.test.tsx`.** Ricopia tutti i casi di `OfflineBar.test.tsx` (C26), renderizzando `<NativeOfflineServices />` insieme all'indicatore dove serve la ripresa. Cambiano solo le asserzioni sul testo:
     - si cerca `getByRole("button", { name: /Offline, dati delle 14:05/ })`;
     - prima del clic `queryByRole("status")` è assente;
     - dopo `fireEvent.click` il fumetto ha il testo (C1).

     Casi in più:
     - dopo 4000 ms il fumetto si chiude;
     - formato di ieri "Offline, dati del 11/10 alle 09:30";
     - nessun elemento con classe `fixed` nel DOM dell'indicatore (C1);
     - evento `offline` della finestra con `NativeOfflineServices` montato → puntino visibile;
     - **C2:** ripresa a 20 s, poi la query mostra i dati nuovi e il puntino sparisce; lo stesso con `visibilitychange` → `visible`;
     - **sul web:** niente puntino e nessun `setInterval` di 20000.
  6. Cancella `OfflineBar.tsx` e `OfflineBar.test.tsx`. Controlla con grep che `OfflineBar` non sia più importato da nessuna parte.
- Verifica: `cd web && npx vitest run src/components/OfflineIndicator.test.tsx src/native/ && npx tsc -b`, risultato atteso: verdi. `grep -rn "OfflineBar" web/src` non trova nulla. Poi `cd web && npm test`.

### [ ] T16. Precarico avviato dai servizi nativi

- Copre: C8, C10, C20, C21, C25, C28
- Rischio: alto
- File:
  - `web/src/native/NativeOfflineServices.tsx` (modifica)
  - `web/src/native/NativeOfflineServices.test.tsx` (nuovo)
- Passi:
  1. Nel `useEffect` nativo di `NativeOfflineServices`, dopo `startConnectivityRecovery()`, chiama `startPrefetch(queryClient)`, con `queryClient` da `useQueryClient()`. La cleanup chiama entrambe le funzioni di stop.
  2. **Test unitari** (`../native/connectivity` e `./prefetchScheduler` parzialmente mockati con spie):
     - in nativo, al mount, `startConnectivityRecovery` e `startPrefetch` sono chiamati una volta ciascuno, e all'unmount le cleanup;
     - sul web nessuna delle due.
  3. **Test di integrazione nello stesso file**, con moduli reali, `fetch` da `routeFetch` di T6, `isNative` true, Preferences e Filesystem mockati, `@capacitor/local-notifications` e `@capacitor/haptics` mockati come in `queryPersistence.restore.native.test.tsx` e `haptics.test.ts`, fake timers.
     - **Montaggio:** monta `QueryClientProvider` (`createQueryClient(true)`) → `MemoryRouter` → `AuthProvider` → `NativeBridge` → `NativeOfflineServices`.
     - **C10:** la prima URL ricevuta da `fetch` è `/api/auth/me`. Nessuna URL di R4 arriva prima della sua risposta e prima di 2000 ms. Dopo `advanceTimersByTimeAsync(2000)` e lo svuotamento delle promise, le URL di R4 arrivano.
     - **C8:** dopo il giro, `LocalNotifications.schedule`, `LocalNotifications.cancel` e le funzioni di `Haptics` mockate non sono chiamati dal giro (azzera i mock dopo il mount, come in T10 della feature precedente). `getQueryData(["gym","workout","active"])` è `undefined`.
     - **C21:** con `/diary/day/...` che risponde 401 `{ detail: "unauthorized" }`, `getToken()` è `null` e `getQueryData(["me"])` è `null`.
  4. `NativeBridge.test.tsx`, `restNotifications.test.ts` e `haptics.test.ts` non si modificano.
- Verifica: `cd web && npx vitest run src/native/ && npx tsc -b`, risultato atteso: verdi. Poi `cd web && npm test`.

### [ ] T17. Puntino negli header

- Copre: C1, C12, C20, C28
- Rischio: alto
- File:
  - `web/src/components/ModeSwitch.tsx` (modifica)
  - `web/src/pages/SettingsPage.tsx` (modifica)
  - `web/src/pages/gym/WorkoutDetailPage.tsx` (modifica)
  - `web/src/pages/gym/WorkoutPage.tsx` (modifica)
  - `web/src/components/ModeSwitch.native.test.tsx` (nuovo)
- Passi:
  1. **`ModeSwitch`.**
     - Con `canGym`: avvolgi il `div role="group"` in `<div className="relative">` e, dopo il gruppo, inserisci `<OfflineIndicator className="absolute left-full top-1/2 ml-1 inline-flex -translate-y-1/2" />`.
     - Senza `canGym`, fuori da `/settings`: `<OfflineIndicator />` al centro della riga, nel flusso.
     - Il ritorno `null` su `/settings` senza palestra resta, così `ModeSwitch.test.tsx` resta invariato.
  2. **`SettingsPage`.** Se `!canUseWorkouts`, metti il titolo "Impostazioni" in un `div className="flex items-center gap-1"` insieme a `<OfflineIndicator />`. Con la palestra il puntino è già in `ModeSwitch`.
  3. **`WorkoutDetailPage`.** Avvolgi l'`h1` in `<div className="relative min-w-0">` e aggiungi `<OfflineIndicator className="absolute left-full top-1/2 inline-flex -translate-y-1/2" />`. La troncatura dell'`h1` deve restare.
  4. **`WorkoutPage`.** Avvolgi lo `<span>` del tempo trascorso in `<span className="relative">` e aggiungi l'indicatore con la stessa classe.
  5. **`ModeSwitch.native.test.tsx`** (`isNative` true, `QueryClientProvider` con `createQueryClient(true)` e una query osservata con dati, `reportNetworkFailure()`). Casi:
     - con la palestra il pulsante "Offline, dati delle …" è dentro lo stesso contenitore `relative` del gruppo "Sezione" e ha classe `absolute`;
     - senza palestra il pulsante c'è;
     - online il pulsante non c'è.

     Aggiungi in questo file un caso per `SettingsPage` senza palestra (mock di `useMe` e `useHasPermission` come in `SettingsPage.test.tsx`) e uno per `WorkoutDetailPage` (mock di `useWorkout` come in `WorkoutDetailPage.test.tsx`): offline compare il pulsante.
  6. `ModeSwitch.test.tsx`, `SettingsPage.test.tsx`, `WorkoutDetailPage.test.tsx`, `WorkoutPage.test.tsx` e `AppShell.test.tsx` non si modificano.
- Verifica: `cd web && npx vitest run src/components/ src/pages/ && npx tsc -b`, risultato atteso: verdi. Poi `cd web && npm test`.

### [ ] T18. Riga "Dati offline" in Impostazioni

- Copre: C13, C20, C28
- Rischio: alto
- File:
  - `web/src/components/OfflineCacheInfo.tsx` (nuovo)
  - `web/src/pages/SettingsPage.tsx` (modifica)
  - `web/src/pages/SettingsPage.native.test.tsx` (nuovo)
- Passi:
  1. **`OfflineCacheInfo`.**
     - Sul web restituisce `null` e non chiama nulla.
     - In nativo, al mount, chiama `getPersistedCacheInfo()` (T4) e mette il risultato in uno stato. Finché la promise non risolve non rende nulla.
     - Con risultato `null` rende "Dati offline: nessuno".
     - Altrimenti rende `Dati offline: circa ${Math.round(sizeBytes / 1024)} KB, salvati alle ${time}`. Se `offlineTimeParts(savedAt, new Date()).day` non è `null`, la parte finale è `salvati il ${day} alle ${time}`: C13 fissa solo il caso di oggi, e "il GG/MM" è la forma corretta in italiano.
     - Stile: `<p className="px-1 text-xs text-slate-500">`.
  2. **`SettingsPage`.** In fondo al contenitore `space-y-4`, `{isNative() && <OfflineCacheInfo />}`.
  3. **`SettingsPage.native.test.tsx`.** Ricopia i mock di `SettingsPage.test.tsx`, mocka `../components/NativeRestAlertSetting` a un `div`, `isNative` true e `@capacitor/filesystem` con `stat`. Casi:
     - `stat` con `size: 430080` e `mtime` = alle 14:05 di oggi (fake timers con data fissa) → "Dati offline: circa 420 KB, salvati alle 14:05";
     - `stat` che rifiuta → "Dati offline: nessuno".

     Più un caso web (`isNative` false), in cui la riga non c'è e `stat` non è chiamato.
  4. `SettingsPage.test.tsx` non si modifica.
- Verifica: `cd web && npx vitest run src/pages/SettingsPage.native.test.tsx src/pages/SettingsPage.test.tsx && npx tsc -b`, risultato atteso: verdi.

### [ ] T19. README: puntino, precarico, "Non disponibile offline"

- Copre: C14
- Rischio: basso
- File: `README.md` (modifica)
- Passi:
  1. Nel punto "Offline, read-only" della sezione "iOS app (IPA)" (intorno alla riga 369), sostituisci la frase sulla barra `Offline, dati delle <time>` con il puntino ambra nell'header che, toccato, mostra l'ora dei dati.
  2. Aggiungi un sotto-punto sul precarico:
     - con rete, all'apertura e al ritorno in primo piano (al più ogni 15 minuti), l'app scarica in background diario di oggi e ieri, settimana corrente, statistiche a 7, 30 e 90 giorni, peso, modelli, catalogo esercizi, ultimi 20 allenamenti con i dettagli e settimane salvate;
     - mai senza rete né sul web.
  3. Aggiungi un sotto-punto: le schermate senza dati mostrano "Non disponibile offline".
  4. Aggiungi il limite sui dati legati alla data: se l'ultimo aggiornamento è di ieri, oggi offline il diario di oggi e le statistiche del periodo corrente non sono disponibili.
  5. Aggiungi la riga "Dati offline" in Impostazioni.
- Verifica: `grep -n "Non disponibile offline" README.md`, risultato atteso: almeno una riga nella sezione iOS. `grep -n "15 minutes\|15 minuti" README.md` trova il throttle. Il punto "Offline, read-only" non nomina più una barra (`grep -n "Offline, dati delle" README.md` trova al più la descrizione del testo del puntino).

### [ ] T20. Non regressione e build

- Copre: C15, C20, C21, C22, C23, C24, C25, C27, C28
- Rischio: basso
- File: nessuno (solo verifica)
- Passi:
  1. Esegui la suite completa in background (circa 2 minuti) e il controllo dei tipi.
  2. Controlla che i test protetti non siano modificati:

     ```
     git diff --stat main -- web/src/auth/AuthGuard.test.tsx web/src/auth/AuthGuard.offline.test.tsx web/src/auth/AuthContext.test.tsx web/src/auth/AuthContext.restAlerts.test.tsx web/src/auth/AuthGuard.native.test.tsx web/src/api/client.test.ts web/src/api/client.errors.native.test.ts web/src/api/client.native.test.ts web/src/api/auth.native.test.ts web/src/api/weights.test.tsx web/src/api/savedWeeks.test.tsx web/src/native/queryPersistence.test.ts web/src/native/queryPersistence.restore.native.test.tsx web/src/native/boot.test.ts web/src/native/restNotifications.test.ts web/src/native/NativeBridge.test.tsx web/src/native/haptics.test.ts web/src/components/gym/RestTimerBar.test.tsx web/src/components/gym/RestTimerBar.native.test.tsx web/src/lib/push.test.ts web/src/components/RestAlertSetting.test.tsx web/src/lib/queryClient.test.ts web/src/pages/DayPage.test.tsx web/src/pages/WeekPage.test.tsx web/src/pages/WeekPage.savedWeeks.test.tsx web/src/pages/DietStatsPage.test.tsx web/src/pages/SavedWeeksPage.test.tsx web/src/pages/SavedWeekDetailPage.test.tsx web/src/pages/SearchPage.test.tsx web/src/pages/SettingsPage.test.tsx web/src/pages/gym/HistoryPage.test.tsx web/src/pages/gym/WorkoutDetailPage.test.tsx web/src/pages/gym/GymStatsPage.test.tsx web/src/pages/gym/WorkoutPage.test.tsx web/src/components/StreakCard.test.tsx web/src/components/WorkoutCountCard.test.tsx web/src/components/gym/ExercisePicker.test.tsx web/src/components/ModeSwitch.test.tsx
     ```

  3. Esegui la build PWA e quella nativa, per controllare che il web resti invariato.
- Verifica:
  - `cd web && npm test`: tutti i test passano;
  - `cd web && npx tsc -b`: nessun errore (C15);
  - il `git diff --stat` del passo 2 è vuoto;
  - `cd web && npm run build && ls dist/sw.js dist/registerSW.js`: entrambi presenti;
  - `cd web && VITE_API_BASE_URL=https://pal.septimilleso.uk/api npm run build:native`: termina senza errori. Alla fine rilancia `npm run build` per lasciare in `dist/` la build della PWA.

### [ ] T21. Verifica sul dispositivo

- Copre: C16, C17, C18, C19, C24, C25
- Rischio: basso
- File: nessuno (registro in questo piano)
- Passi:
  1. Dopo il merge su `main`, crea il tag `v0.0.3` e pushalo solo su `origin` (Gitea). Attendi il run "iOS release" dal mirror e installa l'IPA con SideStore.
  2. Esegui sull'iPhone C16, C17, C18 e C19 come descritti nella spec. Annota per C19 i KB e l'ora mostrati in Impostazioni a ogni passo.
  3. Esegui la parte sul dispositivo di C24 (riapertura in modalità aereo senza login né "Impossibile contattare il server") e di C25 (riposo con avviso, ritorno in primo piano dopo 15 minuti: una sola notifica, nessuna vibrazione in più).
  4. Annota nel registro l'esito punto per punto (OK o KO con nota), non un esito generico.
- Verifica: ogni criterio C16-C19, C24 (dispositivo) e C25 (dispositivo) ha nel registro una riga con esito e nota. Questo task resta in attesa dell'utente.

## Registro di esecuzione

Partenza: d3e58d69bf7c9d41e1ad1c310f8fe18e0c27e71e su main

T1 — DONE — review: saltata
T2 — DONE — review: saltata
T3 — DONE — review: 1 round. MINOR: fetchers.test.ts manca il caso fetchExercises(EMPTY_FILTERS) -> /api/exercises?limit=200 e il caso 200 di fetchGoal/fetchTodayWeight; queries.ts:240-245 docblock di useWeekDiary finito sopra fetchWeekDiary.
T4 — DONE — review: 1 round. MINOR: queryPersistence.ts:204 il commento di getPersistedCacheInfo non indica le unità (sizeBytes in byte, savedAt = mtime in ms epoch, verificato nei tipi di @capacitor/filesystem). Per T6/T8: release di holdQueryPersistence in un `finally` anche con giro interrotto da logout/401/smontaggio (holds mai azzerato, un hold orfano rinvia per sempre le scritture a debounce) e testarlo; il test di C10 deve tenere il documento visibile (hidden aggiunge una scrittura immediata).
T5 — DONE — review: 1 round. MINOR: cachePrune.ts:48 una query senza dati (dataUpdatedAt 0) e senza osservatori viene rimossa; correzione consigliata `if (dataUpdatedAt === 0 || fetchStatus === "fetching") continue;` + test (rischio basso, le query del giro sono protette da keepHashes). Per T6: keepHashes deve includere anche gli hash dei dettagli saltati perché già in cache; il chiamante passa Date.now().
T6 — DONE — review: 1 round. MINOR (test): prefetch.test.ts:199-207 il dettaglio già in cache dovrebbe avere updatedAt di 20 giorni per provare keepHashes; manca il caso admin senza permessi (meWith([], "admin")); manca il test dello storico osservato non sovrascritto. Avvisi per T7/T8: runSequentially ingoia ogni errore (anche NetworkError e 401) e in T7 con errore di rete la pulizia non deve girare; prefetch.ts:52-53 un ["me"] senza permissions rifiuta la promessa prima del try: lo scheduler deve intercettare ogni rifiuto di runPrefetchRound; MAX_CONCURRENT non ancora usata (T7).
T7 — DONE — review: 1 round. Spec precisata con l utente: con 2 lavoratori, dopo errore di rete o 401 nessuna nuova richiesta parte; quella già in volo finisce ma non entra in cache (R7, C6, C7). Incluse le correzioni MINOR di T6 (test keepHashes, admin, storico osservato). MINOR: prefetch.ts:163-177 un lavoratore esce quando la coda è vuota anche se l altro sta producendo figli (concorrenza scende a 1 sulle code finali, solo più lento: contatore active + segnale); prefetch.errors.test.ts:178-181 asserzione tautologica sul cambio token (usare toEqual([])); manca il test che la risposta in volo dopo 401 non entri in cache.
T8 — DONE — review: 1 round (3 MINOR chiusi dall implementer: refreshStaleMe anche su ritorno rete/visibilità, test C10 completo con casi negativi, test senza loop). Avviso: la cleanup non interrompe un giro in corso (lo fa runPrefetchRound sul cambio token); montare startPrefetch (T16) dopo la registrazione di ["me"].
T9 — DONE — review: 1 round. Nota: l hook non è mai provato con useInfiniteQuery (tipo compatibile per deduzione, lo verificherà tsc nei task T10-T14).
T10 — DONE — review: 1 round. MINOR (test): offline.diary.native.test.tsx:139 con rete presente verificare anche "Caricamento..." con retryingQuery; :118 verificare header/frecce/link visibili con il messaggio.
T11 — DONE — review: 1 round. MINOR (test): manca il caso WeightSection enabled=false offline (periodo personalizzato non valido). Nota: la modifica a StreakCard vale anche per GymStatsPage (stessa card), coerente con R12.
T12 — DONE — review: 1 round. MINOR: offline.gym.native.test.tsx:80 verificare anche che "Inizia allenamento" sia disabilitato in pausa; HistoryPage.tsx:84 la guardia !historyUnavailable sul riquadro vuoto è superflua (innocua).
T13 — DONE — review: 1 round (T13 ripreso dopo un limite di sessione, nessuna perdita). Avvisi: la riga di aiuto "Aprila con la rete per averla anche offline." è poco calzante nel picker esercizi (testo opzionale per il componente, da rimandare); offline in GymStatsPage compaiono più messaggi insieme (uno per sezione): da guardare su iPhone; nel picker con filtro in placeholder la lista è sostituita dal messaggio, la selezione resta nel footer.
T14 — DONE — review: 1 round. MINOR accettato: in WorkoutPage.offline.test.tsx aggiunto anche il caso "rete presente + retryingQuery → Caricamento..." oltre al caso consentito. Avvisi (follow-up, fuori da R12): SearchPage ricerca con testo offline mostra "Nessun risultato." (query in pausa, isLoading falso) e alterna con "Caricamento..." ogni 20 s; la tab Recenti sarà sempre "Non disponibile offline" nell IPA (foods* non persistite): da tenere presente su iPhone; WorkoutPage ora richiede isOffline(): se React Query va in pausa per un evento offline di WKWebView prima di reportNetworkFailure si vede "Nessun allenamento in corso." finché startConnectivityRecovery (T15) non ascolta offline: verificare dopo T15.
T15 — DONE — review: 1 round. MINOR (test): OfflineIndicator.test.tsx:775 la chiusura dopo 4000 ms non distingue 4 s da 1 ms (usare 3999+1); manca un test che l indicatore da solo non avvia la ripresa. Per T17: il fumetto è centrato sul puntino e non va a capo, vicino al bordo destro può uscire dallo schermo; chi passa className deve includere relative. Stato intermedio: l indicatore non è montato in nessuna schermata finché non c è T17.
