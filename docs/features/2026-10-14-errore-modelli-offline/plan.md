# Piano: "Errore nel caricamento dei modelli." in modalità aereo nell'IPA

- Data: 2026-10-14
- Stato: approvato
- Spec: [spec.md](spec.md)
- Tipo: bug
- Branch: fix/errore-modelli-offline

## Approccio

Prima si scrive un test di regressione nativo che riproduce la catena descritta nella spec: dati in cache, apertura offline, smontaggio, `retryConnection()`, nuovo montaggio. Senza correzione il test fallisce. Poi si applica la correzione generale nel `QueryCache.onError` di `createQueryClient` (`web/src/lib/queryClient.ts`). Lì, solo nel client nativo, un `NetworkError` su una query con dati riporta la query in `success`/`idle`, dopo il ramo del 401 che resta invariato.

I test seguono i pattern già presenti:
- client nativo reale da `createQueryClient(true)`, montato con `queryClient.mount()` come in `web/src/pages/gym/offline.gym.native.test.tsx` e `web/src/lib/queryClient.test.ts`;
- `isNative` mockato e `@capacitor/preferences` mockato come in `web/src/api/savedWeeks.native.test.tsx`;
- `fetch` sostituito con `vi.stubGlobal`, che rifiuta con `TypeError("Load failed")`;
- connettività gestita con `reportNetworkFailure`, `retryConnection` e `resetConnectivityForTests` di `web/src/native/connectivity.ts`;
- `ModeSwitch` mockato come in `offline.gym.native.test.tsx`, perché legge `AuthContext`.

Un secondo test copre `HistoryPage`, una query infinita, per C1. La verifica sul dispositivo chiude il piano. Le pagine non si toccano.

## Task

Stati: `[ ]` da fare · `[~]` in corso · `[x]` fatto · `[!]` bloccato

### [x] T1. Test di regressione: Modelli offline dopo smontaggio e ripresa

- Copre: C1 (Modelli con e senza dati), C2
- Rischio: alto
- File: `web/src/pages/gym/GymStartPage.offlineError.native.test.tsx` (nuovo)
- Passi:
  1. Preparare il file:
     - mock di `../../native/platform` (`isNative: () => true`);
     - mock di `@capacitor/preferences`, come in `web/src/api/savedWeeks.native.test.tsx`;
     - mock di `../../components/ModeSwitch`, come in `web/src/pages/gym/offline.gym.native.test.tsx`;
     - nessun mock degli hook di `../../api/gym`: il test deve passare dalle `queryFn` reali e da `fetchNative` (`web/src/api/client.ts`).
  2. Scrivere `beforeEach` e `afterEach`:
     - `beforeEach`: `queryClient = createQueryClient(true)`, poi `queryClient.mount()` (così il client resta iscritto a `onlineManager` anche quando il `QueryClientProvider` si smonta), poi `vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Load failed")))`;
     - `afterEach`: `queryClient.unmount()`, `queryClient.clear()`, `vi.unstubAllGlobals()`, `resetConnectivityForTests()`.
  3. Scrivere un helper che fa il render di `GymStartPage` dentro `QueryClientProvider` e `MemoryRouter` su `/gym`, e restituisce `unmount`.
  4. Caso di regressione (C1 primo punto, C2):
     - `queryClient.setQueryData(gymKeys.templates, { folders: [], templates: [{ id: 1, name: "Modello 1", folder_id: null, last_used_at: null, exercise_names: [] }] })`, poi `reportNetworkFailure()`;
     - primo render, attendere con `waitFor` che la query `gymKeys.templates` sia in `fetchStatus: "paused"`;
     - `unmount()`, poi `retryConnection()`;
     - attendere con `waitFor` che `fetch` sia stato richiamato e che la query sia in `fetchStatus: "idle"`;
     - secondo render, poi verificare che "Modello 1" sia visibile, che "Errore nel caricamento dei modelli." non compaia e che `query.state.status` sia `"success"`.
  5. Caso senza dati (C1 secondo punto): stessi passi senza `setQueryData`. Al secondo render compare "Non disponibile offline" e non compare l'errore rosso.
  6. Caso `ApiError` 502 (C2) su query con dati:
     - `setQueryData(gymKeys.templates, …)`;
     - `queryClient.fetchQuery({ queryKey: gymKeys.templates, queryFn: () => Promise.reject(new ApiError(502, "bad gateway", null)), retry: false })` rifiuta;
     - `query.state.status` è `"error"` e i dati restano.
  7. Caso 401 (C2):
     - `setQueryData(["me"], { id: 1 })`;
     - una `fetchQuery` su `gymKeys.templates` che rifiuta con `ApiError(401, "unauthorized", {})` e `retry: false`;
     - `queryClient.getQueryData(["me"])` è `null`.
- Verifica: `cd web && npx vitest run src/pages/gym/GymStartPage.offlineError.native.test.tsx`. Risultato atteso: il caso di regressione **fallisce**, con `status` `"error"` al posto di `"success"`, oppure con "Errore nel caricamento dei modelli." presente. Gli altri tre casi passano.

### [x] T2. Correzione: un errore di rete non porta in errore una query con dati

- Copre: C1, C2, C3
- Rischio: alto
- File: `web/src/lib/queryClient.ts` (modifica)
- Passi:
  1. In `createQueryClient(native)`, dentro `QueryCache.onError`, lasciare il ramo del 401 com'è e per primo.
  2. Dopo il ramo del 401, aggiungere `if (native && error instanceof NetworkError && query.state.data !== undefined)`, con un commento di una riga sul perché (retryer annullato allo smontaggio). Nel ramo chiamare `query.setState({ ...query.state, status: "success", error: null, fetchStatus: "idle", fetchFailureCount: 0, fetchFailureReason: null })`. `NetworkError` è già importato. `Query.setState` accetta `Partial<QueryState>` (React Query 5.102.5).
  3. Non toccare `dataUpdatedAt` né `isInvalidated`: restano grazie allo spread dello stato.
- Verifica:
  - `cd web && npx vitest run src/pages/gym/GymStartPage.offlineError.native.test.tsx`: tutti e quattro i casi passano;
  - `cd web && npx tsc -p tsconfig.app.json`: nessun errore di tipo;
  - `cd web && npm test`: tutti i test verdi, compresi `src/lib/queryClient.test.ts` e `src/components/OfflineIndicator.test.tsx`;
  - `git diff --stat` mostra solo `web/src/lib/queryClient.ts` (i due test esistenti non sono modificati).

### [~] T3. Test della stessa sequenza su Storico

- Copre: C1 (terzo punto), C3
- Rischio: basso
- File: `web/src/pages/gym/HistoryPage.offlineError.native.test.tsx` (nuovo)
- Passi:
  1. Stessa preparazione di T1: mock di platform, preferences e `ModeSwitch`, client nativo montato, `fetch` che rifiuta.
  2. `queryClient.setQueryData(gymKeys.history, { pages: [historyPage(null)], pageParams: [null] })`, usando `historyPage` da `web/src/test/prefetchFixtures.ts`. Poi `reportNetworkFailure()`.
  3. Render di `HistoryPage` su `/gym/history`. Attendere `fetchStatus: "paused"`, poi `unmount()`, `retryConnection()`, attesa di `fetchStatus: "idle"` e nuovo render.
  4. Verificare che "Allenamento 25" sia visibile, che "Errore nel caricamento dello storico." non compaia e che la query `gymKeys.history` sia in `status: "success"`.
- Verifica:
  - `cd web && npx vitest run src/pages/gym/HistoryPage.offlineError.native.test.tsx`: il test passa;
  - `cd web && npm test`: tutti i test verdi.

### [ ] T4. Verifica sull'iPhone

- Copre: C4
- Rischio: basso
- File: Nessuno (task manuale, senza codice)
- Passi:
  1. Produrre l'IPA dal branch con la correzione, con lo stesso flusso usato per la v0.0.3, e installarla con SideStore.
  2. Aprire l'app con rete, fare login e aspettare qualche secondo per il precarico. Poi attivare la modalità aereo.
  3. Aprire Modelli. Passare a Storico e restarci almeno 30 s. Tornare su Modelli.
  4. Ripetere il passo 3 mandando l'app in background e riportandola in primo piano invece di passare a Storico.
  5. Ripetere i passi 3 e 4 con Giorno e con Statistiche al posto di Modelli.
- Verifica: in tutti i casi i dati in cache sono visibili e non compare nessun errore rosso. L'esito va annotato nel registro di esecuzione. Se l'errore compare senza lasciare la schermata, va annotato come indizio dell'ipotesi (a) della spec (vedi "Domande aperte" della spec).

## Registro di esecuzione

T1 — DONE — review: 1 round, APPROVED. MINOR: GymStartPage.offlineError.native.test.tsx:88-90 attesa `fetchMock` soddisfatta anche da useActiveWorkout e asserzione 'Non disponibile offline' fuori da waitFor (usare findByText); :86 commento non verificato (aggiungere `expect(fetchMock).not.toHaveBeenCalled()` dopo retryConnection). Test non committato da solo: va col commit di T2.
T2 — DONE — review: 1 round, APPROVED. Note: dopo la correzione `isInvalidated` e `true` (il reducer error lo imposta prima di onError), effetto voluto; la spec dice "resta", impreciso. T1 e T2 nello stesso commit (regola test di regressione).

Partenza: dda4bbce54dd6b169b7807b5d7387385ebfe9830 su main
