# Piano: IPA, apertura offline con dati in cache, icona e correzioni della feature 1

- Data: 2026-10-12
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: feature
- Branch: `feature/ipa-apertura-offline`

## Approccio

L'apertura offline si costruisce sopra React Query (`@tanstack/react-query` 5.102.5), senza nuove dipendenze npm né plugin nativi. Il piano ha quattro parti:

- **Persistenza.** Un modulo nativo salva su file la cache delle query (`dehydrate`) e la ripristina prima del primo render (`hydrate`).
- **Rete.** Il client HTTP distingue l'errore di rete (`NetworkError`) dall'errore HTTP (`ApiError`). Su un errore di rete mette offline l'`onlineManager` di React Query, così le query con dati restano in stato `success` e vanno in pausa invece di finire in errore. In questo modo le pagine esistenti mostrano i dati in cache senza modifiche.
- **Interfaccia.** `AuthGuard` ha un ramo solo nativo. Una barra offline mostra l'ora dei dati e fa i tentativi di riconnessione.
- **Il resto.** Icona, MINOR e documentazione sono task piccoli e indipendenti.

Codice riusato:

- `web/src/native/session.ts` (`getToken`, `clearToken`).
- `web/src/native/platform.ts` (`isNative`).
- Il plugin `@capacitor/filesystem`, già usato da `installNotificationSound` in `web/src/native/restNotifications.ts`.
- La coda di `restNotifications.ts` per la cancellazione finale al logout.
- `pwa_icons()` in `web/scripts/build-art.py` per l'icona.

Il comportamento web e PWA resta identico: tutto il nuovo codice è dietro `isNative()`, e il `QueryClient` web conserva le opzioni di oggi.

Decisioni di design (prese qui, valgono per tutti i task):

- **Storage: file con `@capacitor/filesystem`.** Directory `Directory.Library`, percorso `yfp/query-cache.json`, `Encoding.UTF8`. Capacitor Preferences scartato: su iOS è `UserDefaults`, che carica tutto in memoria all'avvio e riscrive il plist a ogni `set`, inadatto a una cache di qualche MB. `localStorage` e IndexedDB della WebView scartati per l'NFR "Durata" (pulizia di WebKit). `Library` non viene svuotata da iOS (al contrario di `Caches`), ed è il plugin già incluso nell'IPA.
- **Formato e buster.** Il file contiene `{ buster, savedAt, state }`, dove `state` è il `DehydratedState`. Il buster è `` `${CACHE_SCHEMA_VERSION}|${import.meta.env.VITE_BUILD_ID ?? "dev"}` `` con `CACHE_SCHEMA_VERSION = 1`. In CI `VITE_BUILD_ID` è `github.sha`, quindi ogni nuova IPA scarta la cache della precedente. Il costo è un'apertura online dopo ogni aggiornamento; il guadagno è che non si mostra mai una cache con un formato incompatibile (NFR "Compatibilità tra versioni").
- **Chiavi escluse dalla persistenza** (sia alla scrittura sia al ripristino):
  - `["gym","workout","active"]`, per R8: niente timer falsi, nessun evento verso `NativeBridge`, e lo stato locale resta compito di ADR 0004;
  - tutte le chiavi che iniziano con `"foods"` (ricerca e recenti: la ricerca offline è fuori scope e pesa);
  - tutte le chiavi che iniziano con `"admin"`.

  Si persistono solo le query in stato `success`, e mai le mutazioni (`shouldDehydrateMutation: () => false`). Così il token, che arriva nella risposta di una mutazione di login, non finisce mai nel file.
- **Scrittura.** Avviene 1000 ms dopo l'ultimo evento della `QueryCache`, subito su `visibilitychange` → `hidden` (l'app va in background prima della chiusura dal multitasking), e in una coda serializzata. Si salta se `getToken()` è `null`: dopo logout o 401 nessuna scrittura ricrea il file.
- **`QueryClient` nativo.** Tre opzioni di default:
  - `queries.gcTime: Infinity`, perché la spec non vuole un'età massima e con i 5 minuti di default le query non osservate sparirebbero prima di essere persistite;
  - `queries.retry: (failureCount, error) => error instanceof NetworkError || failureCount < 3`: su errore di rete si riprova sempre, ma il retryer va in pausa finché l'`onlineManager` è offline;
  - `mutations.networkMode: "always"`, perché con il default `"online"` le mutazioni offline andrebbero in pausa e verrebbero rieseguite dopo: sarebbe una coda, vietata da R7. Con `"always"` falliscono subito con `NetworkError`.

  `queries.networkMode` resta `"online"` (default), che è ciò che produce la pausa. Il `QueryClient` web resta con le opzioni di oggi.
- **Connettività.** Il modulo `web/src/native/connectivity.ts` tiene uno stato `offline` e guida `onlineManager`:
  - errore di rete: `offline = true` e `onlineManager.setOnline(false)`;
  - qualsiasi risposta HTTP, anche 4xx o 5xx: `offline = false` e `setOnline(true)`.

  Il ripristino non si affida solo all'evento `online` della WebView, che non arriva se `navigator.onLine` era già vero. Mentre lo stato è offline, `retryConnection()` porta `onlineManager` a online: il retryer delle query in pausa riparte e le query attive vengono rifatte da `refetchOnReconnect`. Questo succede ogni 20 s, al ritorno in primo piano, sull'evento `online` della finestra e su "Riprova". Se fallisce, il client rimette tutto offline. Lo stato `offline` (quello della barra) cambia solo con esiti reali delle richieste.
- **Barra offline.** È visibile solo in nativo, con stato `offline` e almeno una query osservata con dati. L'ora mostrata è il `dataUpdatedAt` minimo tra le query osservate con dati (la più vecchia tra quelle in vista). Testo: "Offline, dati delle HH:MM" se l'ora è di oggi, altrimenti "Offline, dati del GG/MM alle HH:MM". Posizione: fissa in alto, sopra il contenuto, con `padding-top: var(--safe-top)`.

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Test di caratterizzazione del comportamento attuale

- Copre: C21, C22, C26
- Rischio: basso
- File: `web/src/auth/AuthGuard.offline.test.tsx` (nuovo), `web/src/api/client.errors.native.test.ts` (nuovo), `web/src/auth/AuthContext.logout.native.test.tsx` (nuovo)
- Passi:
  1. Non modificare i file di test esistenti. I nuovi file copiano lo schema di mock di `AuthGuard.test.tsx`, `client.native.test.ts` e `AuthContext.native.test.tsx`.
  2. `AuthGuard.offline.test.tsx` (web, `isNative` reale, quindi false in jsdom):
     - con `getMe` che rifiuta con `new TypeError("Failed to fetch")` compaiono "Impossibile contattare il server" e il pulsante "Riprova";
     - un clic su "Riprova" richiama `getMe` una seconda volta;
     - prima della risposta compare "Loading...".
  3. `client.errors.native.test.ts` (`isNative` mockato a true, Preferences mockato, token salvato con `setToken("tok-a")`):
     - con `fetch` che rifiuta, `client.get` rifiuta, `Preferences.remove` non viene chiamato e `getToken()` è ancora `"tok-a"`;
     - con risposta 500 `{detail:"boom"}`, oppure 502 con `json` che lancia, `client.get` rifiuta con `ApiError` (status 500 o 502) e il token resta.
  4. `AuthContext.logout.native.test.tsx`: oltre ai mock di `AuthContext.native.test.tsx`, mocka `../native/restNotifications` con `cancelRestNotification: vi.fn().mockResolvedValue(undefined)`. Verifica che `cancelRestNotification` venga chiamata prima di `logout()` (con `invocationCallOrder`) e che alla fine `navigate` riceva `("/login", { replace: true })`.
- Verifica: `cd web && npx vitest run src/auth/AuthGuard.offline.test.tsx src/api/client.errors.native.test.ts src/auth/AuthContext.logout.native.test.tsx`, risultato atteso: tutti verdi sul codice attuale. Poi `cd web && npm test`: tutti verdi.

### [x] T2. `NetworkError` nel client e modulo di connettività

- Copre: C3, C26
- Rischio: alto
- File: `web/src/native/connectivity.ts` (nuovo), `web/src/native/connectivity.test.ts` (nuovo), `web/src/api/client.ts` (modifica), `web/src/api/client.errors.native.test.ts` (modifica)
- Passi:
  1. In `client.ts` aggiungi ed esporta `class NetworkError extends Error`, con `name = "NetworkError"` e la causa originale in `cause`.
  2. Crea `connectivity.ts`, con stato a livello di modulo `let offline = false` e un set di listener. Esporta:
     - `isOffline(): boolean`;
     - `subscribeConnectivity(listener: () => void): () => void`;
     - `reportNetworkFailure()`: `offline = true`, `onlineManager.setOnline(false)`, notifica i listener solo se lo stato cambia;
     - `reportNetworkSuccess()`: `offline = false`, `onlineManager.setOnline(true)`, notifica se cambia;
     - `retryConnection()`: chiama solo `onlineManager.setOnline(true)` e non tocca `offline`;
     - `startConnectivityRecovery(): () => void`. Se `!isNative()` restituisce una funzione vuota. Altrimenti registra un `setInterval` di 20000 ms che chiama `retryConnection()` se `isOffline()`, un listener `visibilitychange` che lo chiama se `document.visibilityState === "visible"` e `isOffline()`, e un listener `online` su `window` che chiama `retryConnection()`. Restituisce la funzione che rimuove tutto;
     - `resetConnectivityForTests()`: `offline = false`, `onlineManager.setOnline(true)`, svuota i listener.

     `onlineManager` si importa da `@tanstack/react-query`.
  3. In `request()` di `client.ts`, solo se `native`:
     - avvolgi `await fetch(...)` in `try/catch`; nel `catch` chiama `reportNetworkFailure()` e lancia `new NetworkError("network", { cause: error })`;
     - dopo aver ricevuto la `Response`, qualunque sia lo status, chiama `reportNetworkSuccess()`.

     Sul web il codice resta identico: nessun wrap e nessuna chiamata a `connectivity`.
  4. Test in `connectivity.test.ts`:
     - transizioni dello stato e notifiche;
     - `onlineManager.isOnline()` segue `reportNetworkFailure` e `reportNetworkSuccess`;
     - `retryConnection` non cambia `isOffline()`;
     - con `vi.useFakeTimers()` e `isNative` mockato true, `startConnectivityRecovery` chiama `setOnline(true)` dopo 20 s solo se offline, e la cleanup ferma l'intervallo;
     - sul web non registra nulla.

     Chiama `resetConnectivityForTests()` in `afterEach`.
  5. In `client.errors.native.test.ts` aggiorna i casi di T1: con `fetch` che rifiuta, l'errore è `instanceof NetworkError` e `isOffline()` è true; dopo una risposta 500 `isOffline()` è false. Gli altri asserti di T1 restano.
- Verifica: `cd web && npx vitest run src/native/connectivity.test.ts src/api/client.errors.native.test.ts src/api/client.test.ts src/api/client.native.test.ts && npx tsc -b`, risultato atteso: verdi e nessun errore di tipo. Poi `cd web && npm test`: tutti verdi.

### [x] T3. Modulo di persistenza della cache su file

- Copre: C1, C4, C6, C7, C26
- Rischio: alto
- File: `web/src/native/queryPersistence.ts` (nuovo), `web/src/native/queryPersistence.test.ts` (nuovo), `web/src/vite-env.d.ts` (modifica)
- Passi:
  1. In `vite-env.d.ts` dichiara `interface ImportMetaEnv { readonly VITE_API_BASE_URL?: string; readonly VITE_BUILD_ID?: string }`. Prima controlla che `VITE_API_BASE_URL` non sia già tipizzato altrove; in quel caso aggiungi solo `VITE_BUILD_ID`.
  2. In `queryPersistence.ts` definisci:
     - le costanti `CACHE_SCHEMA_VERSION = 1`, `CACHE_PATH = "yfp/query-cache.json"` e `WRITE_DELAY_MS = 1000`;
     - `cacheBuster()`, che restituisce `` `${CACHE_SCHEMA_VERSION}|${import.meta.env.VITE_BUILD_ID ?? "dev"}` ``;
     - `isPersistableKey(queryKey)`: false se la chiave è uguale (per `JSON.stringify`) a `gymKeys.active`, oppure se `queryKey[0]` è `"foods"` o `"admin"`;
     - `shouldPersistQuery(query)`: `query.state.status === "success" && isPersistableKey(query.queryKey)`.
  3. Esporta le funzioni seguenti. Ognuna, se `!isNative()`, non fa nulla e restituisce una promise risolta o una cleanup vuota.
     - `restoreQueryCache(queryClient)`: legge il file con `Filesystem.readFile({ path: CACHE_PATH, directory: Directory.Library, encoding: Encoding.UTF8 })` e fa `JSON.parse`. Se il buster è diverso, o se lettura o parse falliscono, cancella il file (ignorando l'errore) ed esce. Altrimenti filtra `state.queries` con `isPersistableKey` e chiama `hydrate(queryClient, filtered)`. Non lancia mai.
     - `startQueryPersistence(queryClient): () => void`:
       - si iscrive a `queryClient.getQueryCache().subscribe` e a ogni evento (ri)programma una scrittura dopo `WRITE_DELAY_MS`, con un solo timer;
       - su `visibilitychange` con stato `hidden` scrive subito;
       - la scrittura salta se `getToken()` è `null`;
       - altrimenti calcola `dehydrate(queryClient, { shouldDehydrateQuery: shouldPersistQuery, shouldDehydrateMutation: () => false })` e scrive `{ buster, savedAt: Date.now(), state }` con `Filesystem.writeFile({ ..., recursive: true, encoding: Encoding.UTF8 })`;
       - ogni scrittura passa da una coda di promise a livello di modulo, come `queue` in `restNotifications.ts`, e gli errori si ignorano;
       - restituisce la cleanup (unsubscribe, rimozione del listener, `clearTimeout`).
     - `clearPersistedQueryCache(): Promise<void>`: annulla il timer pendente e accoda nella stessa coda un `Filesystem.deleteFile({ path: CACHE_PATH, directory: Directory.Library })`, ignorando l'errore di file assente.
     - `flushQueryPersistenceForTests()`: attende la coda.
  4. Test con `@capacitor/filesystem` mockato (`writeFile`, `readFile`, `deleteFile`, più gli enum `Directory` ed `Encoding`), `isNative` mockato e Preferences mockato:
     - scrittura dopo 1000 ms (fake timers) con token presente; nessuna scrittura senza token;
     - il file scritto non contiene `["gym","workout","active"]`, chiavi `foods` o `admin`, query in errore, né la stringa del token;
     - ripristino con buster uguale: `getQueryData(["me"])` e `getQueryData(["diary","day","2026-10-12"])` presenti, `getQueryData(gymKeys.active)` `undefined` anche se presente nel file;
     - buster diverso o JSON non valido: nessun dato e `deleteFile` chiamato;
     - `clearPersistedQueryCache` annulla una scrittura pendente e chiama `deleteFile`;
     - sul web nessuna chiamata a `Filesystem`.
- Verifica: `cd web && npx vitest run src/native/queryPersistence.test.ts && npx tsc -b`, risultato atteso: verdi, nessun errore di tipo. Poi `cd web && npm test`: tutti verdi.

### [x] T4. Client: 401 di sessione solo per il token corrente e cancellazione della cache

- Copre: C4, C10, C22, C26
- Rischio: alto
- File: `web/src/api/client.ts` (modifica), `web/src/api/client.errors.native.test.ts` (modifica)
- Passi:
  1. In `request()` il token letto all'inizio è già nella costante `token` (riga 29). Nel ramo del 401 con `detail === "unauthorized"` (righe 60-63), esegui `await clearToken().catch(() => undefined)` e `await clearPersistedQueryCache().catch(() => undefined)` solo se `getToken() === token`. Altrimenti non fare nulla e lancia comunque l'`ApiError`.
  2. Non toccare il caso 401 con altro `detail` né il comportamento web.
  3. Aggiungi test in `client.errors.native.test.ts`, con `../native/queryPersistence` mockato (`clearPersistedQueryCache: vi.fn().mockResolvedValue(undefined)`):
     - **C10:** salva il token A e fai partire `client.get` con un `fetch` che resta in sospeso (promise controllata); prima della risoluzione fai `setToken("B")`, poi risolvi con 401 `unauthorized`. Atteso: `getToken()` è `"B"`, `Preferences.remove` e `clearPersistedQueryCache` non chiamati;
     - **stesso token:** con il token ancora A, `getToken()` è `null` e `clearPersistedQueryCache` è chiamato una volta (C4);
     - **401 con altro detail:** `clearPersistedQueryCache` non chiamato.
  4. `client.native.test.ts` deve passare senza modifiche.
- Verifica: `cd web && npx vitest run src/api/client.errors.native.test.ts src/api/client.native.test.ts src/api/auth.native.test.ts`, risultato atteso: verdi. Poi `cd web && npm test`: tutti verdi.

### [ ] T5. `QueryClient` condiviso con le opzioni native e `useMe` in pausa offline

- Copre: C5, C21, C26
- Rischio: alto
- File: `web/src/lib/queryClient.ts` (nuovo), `web/src/lib/queryClient.test.ts` (nuovo), `web/src/App.tsx` (modifica), `web/src/auth/AuthContext.tsx` (modifica)
- Passi:
  1. Crea `createQueryClient(native: boolean): QueryClient` e sposta da `App.tsx` la creazione, con `QueryCache.onError` e `MutationCache.onError` identici a oggi (401 → `setQueryData(["me"], null)` e `invalidateQueries(["me"])`, con l'eccezione di `["me"]` per le query).
     - Se `native` è false, nessun `defaultOptions`, come oggi.
     - Se `native` è true: `defaultOptions: { queries: { gcTime: Infinity, retry: retryNative }, mutations: { networkMode: "always" } }`.
  2. Esporta da `queryClient.ts`:
     - `retryNative = (failureCount, error) => error instanceof NetworkError || failureCount < 3`;
     - `retryOnlyNetwork = (_failureCount, error) => error instanceof NetworkError`;
     - `export const queryClient = createQueryClient(isNative())`.
  3. `App.tsx` importa `queryClient` da `./lib/queryClient` e non ne crea più uno.
  4. In `useMe` (`AuthContext.tsx`) usa `retry: isNative() ? retryOnlyNetwork : false`. Gli altri parametri restano.
  5. Test in `queryClient.test.ts`, con `resetConnectivityForTests()` in `afterEach`:
     - **web:** `createQueryClient(false).getDefaultOptions()` non ha `queries` né `mutations`;
     - **401 su query:** su una query diversa da `["me"]` porta `["me"]` a `null`;
     - **401 su mutazione:** fa lo stesso;
     - **nativo, query offline:** una query con dati e `queryFn` che lancia `NetworkError` dopo aver chiamato `reportNetworkFailure()` resta `status: "success"` con i dati vecchi e arriva a `fetchStatus: "paused"`;
     - **ritorno della rete (C5):** dopo `retryConnection()` con una `queryFn` che ora risolve, i dati diventano quelli nuovi;
     - **mutazione nativa offline:** con `NetworkError` rifiuta subito e non resta in pausa (`isPaused` false), senza coda (R7).
- Verifica: `cd web && npx vitest run src/lib/queryClient.test.ts src/auth/AuthGuard.test.tsx src/auth/AuthContext.test.tsx && npx tsc -b`, risultato atteso: verdi. Poi `cd web && npm test`: tutti verdi.

### [ ] T6. Avvio nativo: ripristino della cache prima del primo render

- Copre: C1, C26
- Rischio: alto
- File: `web/src/native/boot.ts` (nuovo), `web/src/native/boot.test.ts` (nuovo), `web/src/main.tsx` (modifica)
- Passi:
  1. Crea `prepareNativeSession(queryClient): Promise<void>`:
     - `await loadNativeSession()`;
     - se `isNative()` e `getToken()` non è `null`, `await restoreQueryCache(queryClient)`;
     - se `isNative()` e non c'è token, `await clearPersistedQueryCache()`, perché un file senza sessione non deve restare;
     - infine `startQueryPersistence(queryClient)`. Non serve conservare la cleanup: vive quanto l'app.

     Ogni passo è in `try/catch` e un errore non blocca il render.
  2. In `main.tsx` sostituisci `loadNativeSession()` con `prepareNativeSession(queryClient)`, importando `queryClient` da `./lib/queryClient`. Mantieni `.catch(() => undefined).finally(render)`.
  3. Test con `./session` e `./queryPersistence` mockati:
     - con token: ordine `loadNativeSession` → `restoreQueryCache` → `startQueryPersistence`;
     - senza token: `clearPersistedQueryCache` e nessun restore;
     - se `restoreQueryCache` rifiuta, `prepareNativeSession` risolve comunque;
     - sul web (`isNative` false) né restore né clear.
- Verifica: `cd web && npx vitest run src/native/boot.test.ts && npx tsc -b`, risultato atteso: verdi. Poi `cd web && npm test`: tutti verdi.

### [ ] T7. `AuthGuard` nativo: dati in cache, offline senza utente, nessun token

- Copre: C1, C2, C3, C4, C21, C26
- Rischio: alto
- File: `web/src/auth/AuthGuard.tsx` (modifica), `web/src/auth/AuthGuard.native.test.tsx` (nuovo)
- Passi:
  1. In `AuthGuard` dopo `useMe()`, se `!isNative()`, il codice resta identico a oggi.
  2. Se `isNative()`, in quest'ordine:
     1. se `getToken()` è `null`, `<Navigate to="/login" replace />`;
     2. se `query.error` è un `ApiError` con status 401, `<Navigate to="/login" replace />`;
     3. se `query.data`, `<Outlet />`, anche se c'è un errore non 401 o la query è in pausa;
     4. se `query.isLoading`, `<Loading />`;
     5. se `query.error` oppure `query.fetchStatus === "paused"`, la stessa schermata "Impossibile contattare il server" con "Riprova". In nativo "Riprova" chiama `retryConnection()` e poi `void query.refetch()`;
     6. altrimenti `<Navigate to="/login" replace />`.
  3. Test nativi con `isNative` mockato true, Preferences mockato, `fetch` stubbato (si usa `client.ts` reale, non si mocka `getMe`) e `createQueryClient(true)`. In `afterEach`: `resetConnectivityForTests()` e `clearToken()`.
     - **C1:** token impostato, `queryClient.setQueryData(["me"], me)` e `setQueryData(["streak"], {...})` come cache ripristinata, `fetch` che rifiuta sempre. Una rotta protetta mostra `queryClient.getQueryData(["streak"])` tramite `useQuery`; atteso il contenuto protetto, nessun "Impossibile contattare il server", nessun "Login Page".
     - **C2a:** token, nessun `me`, `fetch` che rifiuta. Atteso: "Impossibile contattare il server", `getToken()` invariato.
     - **C2b:** nessun token. Atteso: "Login Page".
     - **C3:** token e `me` in cache, `fetch` che risponde 502 con `json` che lancia. Atteso: contenuto protetto, token invariato.
     - **C4:** token e `me` in cache, `fetch` che risponde 401 `{detail:"unauthorized"}` con `../native/queryPersistence` mockato. Atteso: "Login Page", `getToken()` `null`, `clearPersistedQueryCache` chiamato.
  4. `AuthGuard.test.tsx` e `AuthGuard.offline.test.tsx` passano senza modifiche.
- Verifica: `cd web && npx vitest run src/auth/AuthGuard.native.test.tsx src/auth/AuthGuard.test.tsx src/auth/AuthGuard.offline.test.tsx && npx tsc -b`, risultato atteso: verdi. Poi `cd web && npm test`: tutti verdi.

### [ ] T8. Logout nativo: cache persistente, token e notifica finale (MINOR a, b)

- Copre: C7, C8, C9, C22, C26
- Rischio: alto
- File: `web/src/auth/AuthContext.tsx` (modifica), `web/src/auth/AuthContext.logout.native.test.tsx` (modifica)
- Passi:
  1. Nel ramo nativo di `useLogout`, in quest'ordine:
     1. `await cancelRestNotification().catch(() => undefined)` (come oggi);
     2. `try { await logout() } catch {}` (come oggi);
     3. `await clearToken().catch(() => undefined)` (R12);
     4. `await clearPersistedQueryCache().catch(() => undefined)` (R9).

     Dopo il blocco `if/else` restano `clearClientCaches(queryClient)` e la navigazione. Tra i due aggiungi, solo se `isNative()`, `await cancelRestNotification().catch(() => undefined)` (R11). La navigazione resta l'ultima istruzione.
  2. Il ramo web resta identico.
  3. Test nuovi in `AuthContext.logout.native.test.tsx`:
     - **C7:** `logout` che rifiuta. Atteso: `clearPersistedQueryCache` chiamato, `getToken()` `null`, `navigate("/login", { replace: true })`;
     - **C8:** `cancelRestNotification` deve essere chiamato anche dopo `queryClient.clear()` (spia su `clear` e confronto di `invocationCallOrder` con l'ultima chiamata di `cancelRestNotification`). Con `cancelRestNotification` che rifiuta, il logout arriva comunque a `navigate`;
     - **C9:** `preferences.remove` che rifiuta. Atteso: la promise di `runLogout()` risolve, `navigate` chiamato, `getToken()` `null`; una chiamata successiva `client.get("/x")` con `fetch` stubbato non ha l'header `Authorization`.
  4. `AuthContext.native.test.tsx` e `AuthContext.test.tsx` devono passare senza modifiche. Se `AuthContext.native.test.tsx` fallisce perché non mocka `../native/queryPersistence`, il modulo deve restare no-op senza errori anche con `@capacitor/filesystem` non mockato: `clearPersistedQueryCache` ignora già gli errori.
- Verifica: `cd web && npx vitest run src/auth/`, risultato atteso: verdi. Poi `cd web && npm test`: tutti verdi.

### [ ] T9. Barra offline e ripristino della connessione

- Copre: C5, C27, C26
- Rischio: alto
- File: `web/src/components/OfflineBar.tsx` (nuovo), `web/src/components/OfflineBar.test.tsx` (nuovo), `web/src/App.tsx` (modifica)
- Passi:
  1. `OfflineBar` è un componente di default senza props:
     - se `!isNative()` restituisce `null` e non registra nulla;
     - legge `isOffline` con `useSyncExternalStore(subscribeConnectivity, isOffline)`;
     - con `useQueryClient()` si iscrive alla `QueryCache` per ricalcolare l'ora;
     - in un `useEffect` chiama `startConnectivityRecovery()` e ne usa la cleanup.
  2. Calcolo dell'ora: tra `queryClient.getQueryCache().getAll()`, le query con `getObserversCount() > 0`, `state.data !== undefined` e `state.dataUpdatedAt > 0`; prendi il `dataUpdatedAt` minimo. Se non ce n'è nessuna, o se non si è offline, restituisci `null`.
  3. Rendering: `<div role="status">` fisso in alto (`fixed inset-x-0 top-0 z-50`), con `style={{ paddingTop: "var(--safe-top)" }}`, testo piccolo e sfondo ambra. Testo "Offline, dati delle HH:MM" se la data è di oggi, altrimenti "Offline, dati del GG/MM alle HH:MM". Usa `toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })` e `toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })`.
  4. In `App.tsx` monta `<OfflineBar />` subito dopo `<NativeBridge />`.
  5. Test (fake timers per data e ora fissate, `isNative` mockato, `resetConnectivityForTests()` in `afterEach`):
     - **C27, barra visibile:** query osservata con dati aggiornati alle 14:05 di oggi e `reportNetworkFailure()`. Atteso: "Offline, dati delle 14:05";
     - **C27, barra nascosta:** dopo `reportNetworkSuccess()` la barra sparisce;
     - **C27, rete presente:** la barra non c'è;
     - **C27, web:** la barra non c'è e `startConnectivityRecovery` non registra intervalli;
     - **C27, ieri:** dati di ieri mostrano "dati del GG/MM alle HH:MM";
     - **C5:** con `createQueryClient(true)`, una query osservata in pausa per `NetworkError` e `fetch` che ora risponde 200. Dopo 20 s (`vi.advanceTimersByTime(20000)`), la query viene rifatta, mostra i dati nuovi e la barra sparisce.
- Verifica: `cd web && npx vitest run src/components/OfflineBar.test.tsx && npx tsc -b`, risultato atteso: verdi. Poi `cd web && npm test`: tutti verdi.

### [ ] T10. Allenamento attivo senza segnali falsi offline

- Copre: C6, C23, C26
- Rischio: alto
- File: `web/src/pages/gym/WorkoutPage.tsx` (modifica), `web/src/pages/gym/WorkoutPage.offline.test.tsx` (nuovo), `web/src/native/queryPersistence.restore.native.test.tsx` (nuovo)
- Passi:
  1. In `WorkoutPage`, prima di `if (!workout)` (riga 83), aggiungi un caso solo nativo. Prendi `fetchStatus` da `useActiveWorkout()`. Se `isNative()`, `!workout` e `fetchStatus === "paused"`, mostra "Allenamento non disponibile offline" con un link "Vai ai modelli" a `/gym`, invece di "Nessun allenamento in corso". Sul web resta tutto com'è.
  2. Test `WorkoutPage.offline.test.tsx` (mock di `useActiveWorkout` che restituisce `{ data: undefined, isLoading: false, isError: false, fetchStatus: "paused" }`, `isNative` mockato):
     - in nativo compare "Allenamento non disponibile offline" e non "Nessun allenamento in corso";
     - con `isNative` false compare "Nessun allenamento in corso".

     Ricopia i mock necessari da `WorkoutPage.test.tsx`.
  3. Test `queryPersistence.restore.native.test.tsx` (C6), con `isNative` true, Filesystem mockato e `@capacitor/local-notifications` mockato (`schedule`, `cancel`, `checkPermissions`, `addListener`):
     - monta `<NativeBridge />` dentro `QueryClientProvider` e `MemoryRouter`;
     - azzera i mock dopo il mount, perché il mount chiama `installNotificationSound`;
     - chiama `restoreQueryCache(queryClient)` con un file che contiene un `["me"]` e un `["gym","workout","active"]`, con `rest_ends_at` e `server_now` di 3 ore prima e buster corretto;
     - attende 50 ms.

     Atteso: `getQueryData(gymKeys.active)` `undefined`, e `LocalNotifications.schedule` e `LocalNotifications.cancel` mai chiamati.
  4. `RestTimerBar.test.tsx`, `RestTimerBar.native.test.tsx`, `NativeBridge.test.tsx` e `restNotifications.test.ts` passano senza modifiche.
- Verifica: `cd web && npx vitest run src/pages/gym/ src/native/ src/components/gym/`, risultato atteso: verdi. Poi `cd web && npm test`: tutti verdi.

### [ ] T11. Icona dell'app dal gatto chef

- Copre: C11
- Rischio: basso
- File: `web/scripts/build-art.py` (modifica), `web/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` (rigenerato)
- Passi:
  1. In `build-art.py` estrai da `pwa_icons()` la costruzione di `opaque_inner` (righe 311-321) in una funzione `opaque_full_bleed(source) -> Image`, usata sia da `pwa_icons()` (stesso output di oggi) sia dalla nuova `ios_app_icon()`.
  2. `ios_app_icon()`:
     - calcola `opaque_full_bleed` da `ART / "dieta" / "app-icon.png"`;
     - la ridimensiona a 1024x1024 con `Image.Resampling.LANCZOS` e la converte in `RGB`;
     - la salva con `optimize=True` in `ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset" / "AppIcon-512@2x.png"`, lo stesso nome già referenziato da `Contents.json`, che non va toccato.
  3. Chiama `ios_app_icon()` in `main()` dopo `pwa_icons()`.
  4. Esegui lo script da root: `python web/scripts/build-art.py`.
- Verifica: `file web/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`, risultato atteso: `PNG image data, 1024 x 1024, 8-bit/color RGB`. Apri l'immagine: deve essere il gatto chef su fondo salvia, a piena area e senza angoli trasparenti. `git status --porcelain web/public` deve risultare vuoto (icone PWA e art invariate). Rieseguendo lo script, `git status --porcelain web/ios` non mostra nuove differenze rispetto alla prima esecuzione. Se `web/public` cambia per una diversa versione di Pillow, ripristina quei file con `git checkout -- web/public` e annotalo nel registro.

### [ ] T12. Workflow iOS e README

- Copre: C12, C13
- Rischio: basso
- File: `.github/workflows/ios-release.yml` (modifica), `README.md` (modifica)
- Passi:
  1. In `ios-release.yml`, al passo `- uses: actions/checkout@v4` (riga 41) aggiungi `with:` e `ref: ${{ env.TAG }}`. Se il tag non esiste il checkout fallisce, prima di qualsiasi release.
  2. Nel passo "Build web and sync Capacitor", in `env:`, aggiungi `VITE_BUILD_ID: ${{ github.sha }}`.
  3. In `README.md`, sezione "Notes on this version", sostituisci il punto "Network required" con un punto "Offline (read-only)", che dice:
     - l'app si apre senza rete con i dati già visti online;
     - mostra la barra "Offline, dati delle <ora>";
     - le modifiche richiedono la rete e non vengono messe in coda;
     - la sessione live dell'allenamento non è disponibile offline;
     - dopo l'installazione, e dopo ogni aggiornamento dell'IPA, serve un'apertura con rete prima che la cache sia disponibile;
     - la cache si cancella al logout o quando la sessione viene revocata.
  4. In "Releasing", punto 4, precisa che "Run workflow" costruisce il commit del tag indicato e che il tag deve essere già arrivato su GitHub tramite il mirror. Altrimenti il run fallisce al checkout e non crea il tag.
- Verifica: `grep -n "ref: \${{ env.TAG }}" .github/workflows/ios-release.yml`, risultato atteso: una riga sotto `actions/checkout@v4`. `grep -c "Network required" README.md`, risultato atteso: `0`. `grep -n "Offline" README.md` mostra il nuovo punto.

### [ ] T13. Non regressione e build

- Copre: C21, C22, C23, C24, C26
- Rischio: basso
- File: nessuno (solo verifica)
- Passi:
  1. Esegui la suite completa.
  2. Esegui la build PWA e controlla `dist/`.
  3. Esegui la build nativa con e senza `VITE_API_BASE_URL`.
  4. Controlla che i file di test elencati in C21 e C23 non siano modificati: `git diff --stat main -- web/src/auth/AuthGuard.test.tsx web/src/auth/AuthContext.test.tsx web/src/api/client.test.ts web/src/api/weights.test.tsx web/src/api/savedWeeks.test.tsx web/src/native/restNotifications.test.ts web/src/native/NativeBridge.test.tsx web/src/native/haptics.test.ts web/src/components/gym/RestTimerBar.test.tsx web/src/components/gym/RestTimerBar.native.test.tsx web/src/lib/push.test.ts web/src/components/RestAlertSetting.test.tsx` deve essere vuoto.
- Verifica:
  - `cd web && npm test`: tutti i test passano;
  - `cd web && npm run build && ls dist/sw.js dist/registerSW.js`: entrambi presenti;
  - `cd web && VITE_API_BASE_URL=https://pal.septimilleso.uk/api npm run build:native && ls dist/sw.js dist/registerSW.js; grep -rl "pal.septimilleso.uk/api" dist/assets`: i due `ls` falliscono (file assenti) e `grep` trova almeno un file;
  - `cd web && npm run build:native`: fallisce con "VITE_API_BASE_URL è obbligatorio per la build nativa".

  Alla fine rilancia `npm run build` per lasciare `dist/` della PWA.

### [ ] T14. Verifica in CI e sul dispositivo

- Copre: C14, C15, C16, C17, C18, C19, C20, C25
- Rischio: basso
- File: nessuno (registro in questo piano)
- Passi:
  1. **C15.** Dopo il merge su `main`, crea un tag `vX.Y.Z` e pushalo solo su `origin` (Gitea). Attendi il run "iOS release" dal mirror e controlla la release GitHub e quella Gitea, con `CFBundleShortVersionString` uguale al tag.
  2. **C14.** Da GitHub Actions lancia "iOS release" con "Run workflow" da `main`, indicando lo stesso tag: il log del checkout mostra il commit del tag. Lancialo poi con un tag inesistente (per esempio `v9.9.9`): il run fallisce al checkout e su GitHub non compare il tag.
  3. Sull'iPhone (iOS 26, SideStore) installa l'IPA del punto 1 ed esegui C16, C25, C17 (compreso il riavvio del telefono), C18, C19 e C20, come descritti nella spec.
  4. Annota nel registro l'esito punto per punto, non un esito generico.
- Verifica: ogni criterio C14-C20 e C25 ha nel registro una riga con esito OK o KO e una nota.

## Registro di esecuzione

Partenza: 2e18773b0374f2a1605b278f283e3f98f152af93 su main

T1 — DONE — review: saltata
T2 — DONE — review: 1 round. Avvisi: client.ts fetchNative tratta AbortError come errore di rete (nessun chiamante usa signal); errore a metà body resta TypeError generico, da tenere presente in T5/T10.
T3 — DONE — review: 1 round. MINOR: queryPersistence.ts:89 restore non rifiltra status success né svuota mutations; mancano test (scrittura in coda dopo clear, chiavi foods/admin al ripristino, writeFile che rifiuta). Vincolo per T4/T8: clearToken() prima di clearPersistedQueryCache(). Avviso: dopo 401 la cache in memoria resta piena, un nuovo login riscrive i dati vecchi su file (verificare in T4/T7); debounce si riarma a ogni evento.
T4 — DONE — review: 1 round. Avvisi: ciclo di import client.ts -> queryPersistence.ts -> api/gym.ts -> client.ts sicuro solo finché nessun binding è usato a livello di modulo (nessun TDZ oggi, build ok); il 401 non svuota le query in memoria: decidere in T7/T8 (queryClient.clear) per evitare che un nuovo login riscriva dati vecchi su file.
