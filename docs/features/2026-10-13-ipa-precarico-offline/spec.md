# Spec: IPA, precarico delle schermate per l'offline, indicatore offline discreto e messaggio "non disponibile offline"

- Data: 2026-10-13
- Tipo: feature
- Stato: approvato
- Brainstorm: saltato
- Branch: `feature/ipa-precarico-offline`, da `main` (`d3e58d6`, dopo il tag `v0.0.2`)

## Obiettivo

Provata la v0.0.2 sull'iPhone, la cache offline contiene troppo poco: appena ci si sposta offline si trovano schermate vuote, e la barra "Offline, dati delle HH:MM" in alto è invasiva. Con questa feature l'IPA, quando ha rete, scarica in background le schermate principali (diario di oggi e ieri, settimana, statistiche, modelli, esercizi, storico allenamenti) così da poterle aprire offline. La barra diventa un puntino discreto che mostra l'ora dei dati al tocco, e le schermate che offline non hanno dati mostrano "Non disponibile offline" invece di restare vuote. Web e PWA restano identici.

## Contesto tecnico

Riferimenti:

- [Spec della feature precedente](../2026-10-12-ipa-apertura-offline/spec.md), [piano](../2026-10-12-ipa-apertura-offline/plan.md) e [review](../2026-10-12-ipa-apertura-offline/review.md), mergiati su `main` e rilasciati come `v0.0.2`. Questa feature cambia tre punti di quella spec:
  - R16 (barra offline): la barra diventa un puntino e la logica resta la stessa;
  - R2 (schermata senza dati "nel proprio stato di errore o vuoto"): ora deve mostrare un messaggio esplicito;
  - il fuori scope "Scaricamento preventivo (prefetch) di dati mai aperti online": ora il precarico entra.

  Restano valide le decisioni del piano: file `yfp/query-cache.json` in `Directory.Library`, buster per tag, chiavi escluse, `gcTime: Infinity`, `NetworkError` e `connectivity`. Resta valido anche l'avviso della review sulle schermate che offline restano "con l'header e nessun contenuto".
- [ADR 0004](../../decisions/0004-palestra-offline-sync-a-blocco.md): prevede che "i dati di supporto (catalogo, template, precedente/max, storico recente)" siano "scaricati in cache all'apertura". Questa feature ne anticipa solo il download, in sola lettura. Stato locale, reducer, outbox e `PUT /workouts/{uuid}` restano fuori.
- [ADR 0003](../../decisions/0003-auth-bearer-client-nativo.md): il trasporto Bearer non cambia.
- [Brainstorm app-ios-offline](../2026-10-12-app-ios-offline/brainstorm.md), punto 3 della roadmap ("cache all'apertura").
- [Design palestra](../../superpowers/specs/2026-09-24-gym-workouts-design.md): `list_workouts(user, before?, limit=20)` con paginazione, da cui viene la pagina di 20 voci dello storico.

Parti coinvolte (stato attuale su `main`):

- **Avvio.** `web/src/main.tsx` esegue `prepareNativeSession(queryClient)` (`web/src/native/boot.ts`) prima del primo render, cioè `loadNativeSession` → `restoreQueryCache` → `startQueryPersistence`. Oggi nessun dato viene scaricato oltre a quelli richiesti dalla schermata aperta.
- **QueryClient.** `web/src/lib/queryClient.ts`, `createQueryClient(native)`:
  - nel client nativo: `gcTime: Infinity`, `retry: retryNative` (`web/src/lib/retry.ts`, che ritenta sempre un `NetworkError` e fino a 3 volte gli altri errori, compresi i 4xx), mutazioni con `networkMode: "always"`, `["foods"]` con `gcTime` di 5 minuti;
  - in tutti e due i client, un 401 su una query diversa da `["me"]` porta `["me"]` a `null`.
- **Persistenza.** `web/src/native/queryPersistence.ts`:
  - riscrive l'intero file a ogni scrittura: 1000 ms dopo l'ultimo evento della `QueryCache`, e subito su `visibilitychange` → `hidden`;
  - salta la scrittura senza token;
  - esclude `["gym","workout","active"]`, `foods*`, `admin*` e le ricerche esercizi con `q` non vuoto;
  - persiste le query con dati anche se sono in errore, normalizzate a `success`.
- **Connettività.** `web/src/native/connectivity.ts`: `isOffline()` diventa true su un errore di rete o sull'evento `offline`, e false su qualunque risposta HTTP. `startConnectivityRecovery()` riprova ogni 20 s, al ritorno in primo piano e sull'evento `online`; oggi lo avvia `OfflineBar`.
- **Barra offline.** `web/src/components/OfflineBar.tsx`, montata in `web/src/App.tsx` dopo `<NativeBridge />`. È `fixed inset-x-0 top-0 z-50` con `paddingTop: var(--safe-top)`, quindi copre la status bar e la parte alta della `.app-header` sticky (`web/src/index.css:118-121`). Compare se `isOffline()` ed esiste almeno una query osservata con dati. L'ora è il `dataUpdatedAt` minimo tra le query osservate, esclusa `["me"]` (usata solo se è l'unica). Il testo è "Offline, dati delle HH:MM" per i dati di oggi, altrimenti "Offline, dati del GG/MM alle HH:MM".
- **Header.** `web/src/components/ModeSwitch.tsx` è la riga superiore della `.app-header` nelle pagine principali: pulsante peso a sinistra, interruttore "Dieta | Palestra" al centro (solo con `workouts.use`), ingranaggio a destra. Ne fanno a meno `WorkoutDetailPage` e `WorkoutPage`, che hanno un header proprio, mentre `SettingsPage` la nasconde se l'utente non ha `workouts.use`. La tab bar è in `web/src/components/AppShell.tsx` (`fixed bottom-0 z-30`, `--nav-height`); `ActiveWorkoutBar` sta sopra la tab bar.
- **Notifiche e aptici.** `web/src/native/NativeBridge.tsx` reagisce solo agli aggiornamenti riusciti di `gymKeys.active` (`["gym","workout","active"]`). Attenzione: le chiavi `gymKeys.workout(id)` (`["gym","workout",id]`) condividono il prefisso `["gym","workout"]` con la chiave attiva, e `useWorkoutTemplateMutation` (`web/src/api/gym.ts`) invalida proprio quel prefisso.
- **Chiavi e funzioni delle query.** Sono in `web/src/api/queries.ts`, `web/src/api/gym.ts` (`gymKeys`), `web/src/api/weights.ts` (`weightKeys`), `web/src/api/savedWeeks.ts` (`savedWeekKeys`) e `web/src/auth/AuthContext.tsx` (`["me"]`). Alcune funzioni trasformano la risposta: `useGoal` converte il 404 in `null`, `useTodayWeight` e `useActiveWorkout` convertono il 204 in `null`, `useHistory` è una `useInfiniteQuery` con `initialPageParam: null`. Le date vengono da `web/src/lib/date.ts` (`todayIso`, `shiftIsoDate`, `startOfWeek`), i periodi delle statistiche da `web/src/lib/stats.ts` (`PRESETS = [7, 30, 90]`, `presetPeriod`) e da `web/src/lib/usePeriodParams.ts` (default 7 giorni).
- **Permessi.** `web/src/lib/permissions.ts`. Le API della palestra non richiedono `workouts.use` lato server (`api/app/routers/workouts.py`, `stats.py`), ma la UI le mostra solo con quel permesso (`PermissionGuard` in `App.tsx`). Le API delle settimane salvate richiedono `diary.copy` lato server (`api/app/routers/saved_weeks.py`) e rispondono in ordine `created_at` decrescente. I modelli sono in ordine di `position` (`api/app/services/templates.py:138`).
- **Comportamento offline oggi senza dati.** Con `onlineManager` offline la query resta in pausa (`fetchStatus: "paused"`, `isLoading` e `isError` falsi, nessun dato). Ogni 20 s `retryConnection()` la fa ripartire (`fetching`, quindi `isLoading` vero) finché la richiesta non fallisce di nuovo. Gli effetti per schermata:
  - `DayPage`, `WeekPage`, `HistoryPage`, `WorkoutDetailPage` e `SavedWeeksPage` restano con il solo header, e alternano "Caricamento..." a ogni tentativo;
  - in `DietStatsPage` i grafici sono vuoti, `StreakCard` mostra "Caricamento..." e `WeightSection` mostra "Nessuna pesata nel periodo";
  - `GymStatsPage` e `WorkoutCountCard` restano su "Caricamento..." (`isLoading || !data`);
  - `ExerciseList` mostra "Nessun esercizio trovato." e, con un filtro attrezzo o muscolo, l'elenco non filtrato come `placeholderData`;
  - `GymStartPage` mostra i pulsanti senza modelli;
  - `SavedWeekDetailPage` mostra il solo header;
  - `SearchPage` mostra "Nessun alimento recente.";
  - in `AccountPage` la sezione "Sessioni attive" è vuota;
  - `TemplatePreviewSheet` ed `ExerciseDetailSheet` sono vuoti;
  - `WorkoutPage` ha già "Allenamento non disponibile offline" (T10 della feature precedente), basato su `fetchStatus === "paused"`.
- **Impostazioni.** `SettingsPage` usa solo `["me"]`, già persistita, e `NativeRestAlertSetting` (Preferences e permessi locali): è già apribile offline e non ha bisogno di precarico.

Vincoli:

- Nessuna nuova dipendenza npm né plugin nativo: il ritorno in primo piano si rileva con `visibilitychange`, come già fanno `ActivityTracker`, `queryPersistence` e `connectivity`.
- Nessuna modifica all'API né a `api/`. `cd web && npm test` gira in locale; pytest non serve.
- Gitea (`origin`) è la fonte; GitHub è solo un mirror.
- Distribuzione con SideStore: nessuna extension e nessun App ID in più.

## Impatto sull'esistente

- Comportamenti che cambiano:
  - Nell'IPA la barra ambra "Offline, dati delle HH:MM" in alto non c'è più. Al suo posto, offline, compare un puntino nell'header; toccandolo si legge lo stesso testo.
  - Nell'IPA, con rete, all'apertura e al ritorno in primo piano (al più una volta ogni 15 minuti) l'app scarica in background le schermate elencate in R4. Il traffico cresce: indicativamente fino a circa 85 richieste GET al primo giro, poi 30-50 per giro.
  - Nell'IPA, offline, le schermate e le sezioni senza dati mostrano "Non disponibile offline" invece di vuoto, "Caricamento..." infinito o "Nessun ..." fuorviante.
  - Nell'IPA, le Impostazioni mostrano una riga con il peso e l'ora del file dei dati offline (R14).
  - Nell'IPA la cache su file rimuove da sola le query vecchie delle famiglie con data (R10).
  - Il `README.md`, sezione iOS, descrive il puntino e il precarico.
- Comportamenti da preservare:
  - Web e PWA: nessun puntino, nessun precarico, nessun messaggio "Non disponibile offline", `QueryClient` web senza `defaultOptions`, `AuthGuard` web invariato, service worker e `api-foods-cache` invariati. Criterio: C20.
  - Un 401 di sessione con rete (`detail` `unauthorized`) porta al login, rimuove il token e cancella il file. Vale anche se arriva da una richiesta del precarico. Criterio: C21.
  - R4 della feature precedente: un errore che non sia un 401 di sessione (rete assente, 5xx, risposta non JSON) non rimuove il token, non cancella la cache e non porta al login. Vale anche per le richieste del precarico. Criterio: C22.
  - La cache non viene scritta senza token, né dopo logout o 401. Criterio: C23.
  - Apertura offline con cache: si entra nell'app con i dati salvati; senza `["me"]` in cache compare "Impossibile contattare il server"; senza token compare il login. Criterio: C24.
  - Notifiche locali di fine riposo, campanella e aptico (R8 della feature precedente e R9-R10 della feature 1): l'allenamento attivo resta escluso dalla persistenza e non viene mai precaricato. Criterio: C25.
  - Logica dell'indicatore offline: stesse condizioni di comparsa e scomparsa, stessa ora con l'esclusione di `["me"]`, stessi formati di testo, stessi tentativi di ripresa della connessione (ogni 20 s, al ritorno in primo piano, sugli eventi `online` e `offline`). Criterio: C26.
  - Scritture offline: falliscono subito con l'errore della schermata, senza coda (R7 della feature precedente). Criterio: C27.
- Compatibilità: retrocompatibile. Nessun endpoint e nessun formato API cambiano. Il formato del file di cache non cambia (`CACHE_SCHEMA_VERSION` resta 1), e il buster per tag scarta comunque la cache della `v0.0.2` al primo avvio della nuova IPA. Le chiavi precaricate sono le stesse usate dalle pagine, quindi i dati precaricati e quelli caricati dalla pagina sono intercambiabili.
- Migrazioni: nessuna (né DB, né configurazione, né dati sul dispositivo).

## Requisiti funzionali

Indicatore offline (solo IPA):

- **R1**: Nell'IPA la barra offline deve essere sostituita da un indicatore discreto, un puntino. Il puntino non deve coprire né spostare in modo percepibile nessun elemento: testo e controlli dell'header (pulsante peso, interruttore Dieta/Palestra, ingranaggio, frecce e titoli), contenuto della pagina, tab bar, barra dell'allenamento attivo. Deve inoltre stare fuori dalla safe area superiore (status bar e Dynamic Island). Deve essere visibile in ogni schermata autenticata con un header, comprese `WorkoutDetailPage` e `WorkoutPage`. Compare e sparisce alle stesse condizioni della barra di oggi (C26). Nel browser e nella PWA non compare.
- **R2**: Toccando il puntino deve comparire il testo "Offline, dati delle HH:MM" (oppure "Offline, dati del GG/MM alle HH:MM"), calcolato come oggi: `dataUpdatedAt` minimo tra le query osservate con dati, con `["me"]` esclusa salvo che sia l'unica. Il testo si chiude toccando di nuovo o dopo qualche secondo, e può sovrapporsi al contenuto solo mentre è aperto. Il puntino ha un'area di tocco adeguata (circa 44 px) e un nome accessibile che contiene lo stesso testo.
- **R3**: I tentativi di ripresa della connessione (`startConnectivityRecovery`) devono restare attivi nell'IPA come oggi anche senza la barra, compresi quelli fatti mentre il puntino non è visibile.

Precarico (solo IPA):

- **R4**: Nell'IPA, con token e rete, l'app deve precaricare in background le query della tabella seguente, con le stesse chiavi e le stesse funzioni (`queryFn`, `initialPageParam` e trasformazioni del 404/204) usate dalle pagine, così che una pagina aperta dopo trovi dati identici a quelli che avrebbe scaricato da sola. In tabella, `oggi` è `todayIso()`, `ieri` è `shiftIsoDate(oggi, -1)`, `lunedì` è `startOfWeek(oggi)`, e `inizio(N)` è `presetPeriod(N, oggi).start` per N in 7, 30 e 90. I percorsi sono relativi alla base API (`VITE_API_BASE_URL`).

  | Gruppo | Condizione | Chiave | Endpoint | Quante |
  |---|---|---|---|---|
  | Diario | sempre | `["diary","day",oggi]`, `["diary","day",ieri]` | `GET /diary/day/{data}` | 2 |
  | Diario | sempre | `["diary","week",lunedì]` | `GET /diary/week?start={lunedì}` | 1 |
  | Diario | sempre | `["goals"]` | `GET /goals` (404 → `null`) | 1 |
  | Statistiche dieta | sempre | `["streak"]` | `GET /stats/streak` | 1 |
  | Statistiche dieta | sempre | `["diary","range",inizio(N),oggi]` | `GET /diary/range?start=&end=` | 3 |
  | Peso | sempre | `["weight","today"]` | `GET /weights/today` (204 → `null`) | 1 |
  | Peso | sempre | `["weight","range",inizio(N),oggi]` | `GET /weights?start=&end=` | 3 |
  | Settimane salvate | `diary.copy` | `["saved-weeks","list"]` | `GET /saved-weeks` | 1 |
  | Settimane salvate | `diary.copy` | `["saved-weeks","detail",id]` per le prime 10 dell'elenco (le più recenti) | `GET /saved-weeks/{id}` | ≤ 10 |
  | Palestra, modelli | `workouts.use` | `["gym","templates"]` | `GET /templates` | 1 |
  | Palestra, modelli | `workouts.use` | `["gym","template",id]` per i primi 30 modelli nell'ordine della risposta | `GET /templates/{id}` | ≤ 30 |
  | Palestra, esercizi | `workouts.use` | `["gym","exercises",{q:"",equipment:"",muscle:""}]` (`EMPTY_FILTERS`) | `GET /exercises?limit=200` | 1 |
  | Palestra, storico | `workouts.use` | `["gym","history"]` (infinite query, prima pagina) | `GET /workouts?limit=20` | 1 |
  | Palestra, storico | `workouts.use` | `["gym","workout",id]` per gli allenamenti della prima pagina, solo quelli non già in cache | `GET /workouts/{id}` | ≤ 20 |
  | Statistiche palestra | `workouts.use` | `["gym","stats","count"]` | `GET /stats/gym/count` | 1 |
  | Statistiche palestra | `workouts.use` | `["gym","stats","range",inizio(N),oggi]` | `GET /stats/gym?start=&end=` | 3 |
  | Statistiche palestra | `workouts.use` | `["gym","stats","exercises"]` | `GET /stats/gym/exercises` | 1 |
  | Statistiche palestra | `workouts.use` | `["gym","stats","progress",id0,inizio(N),oggi]`, dove `id0` è il primo esercizio dell'elenco (la selezione predefinita di `ExerciseProgressSection`) | `GET /stats/gym/exercises/{id0}?start=&end=` | 3 se l'elenco non è vuoto |

  I permessi si leggono da `["me"]`; un admin li ha tutti. Le Impostazioni non richiedono precarico (bastano `["me"]` e i dati locali). Non vengono mai precaricati:
  - `["gym","workout","active"]` (`/workouts/active`);
  - le chiavi `foods*` (ricerche e recenti), `admin*` e `["gym","exercise",id]`;
  - le ricerche esercizi con `q` e i filtri attrezzo o muscolo;
  - `["auth","sessions"]`, le connessioni MCP e `["push-config"]`;
  - i periodi personalizzati delle statistiche;
  - giorni diversi da oggi e ieri, e settimane diverse dalla corrente.
- **R5**: Il precarico deve partire in questi casi:
  - all'apertura a freddo dell'app (nuovo processo), dopo il primo render e dopo la prima risposta riuscita di `/auth/me` in quell'esecuzione;
  - al ritorno in primo piano (`visibilitychange` → `visible`);
  - al ritorno della rete dopo uno stato offline.

  Negli ultimi due casi parte solo se l'ultimo giro completato risale a più di 15 minuti prima (throttle). Se all'apertura a freddo non c'era rete, il primo giro parte al ritorno della rete. Un solo giro alla volta: un trigger arrivato durante un giro in corso viene ignorato.
- **R6**: Il precarico non deve mai partire:
  - nel browser o nella PWA;
  - senza token (`getToken()` è `null`);
  - con lo stato di rete offline (`isOffline()` o `onlineManager` offline);
  - senza un utente in cache (`["me"]` assente o `null`);
  - sulle pagine non autenticate (login, `/connect`).
- **R7**: Il precarico deve essere silenzioso: nessun messaggio d'errore, nessuna navigazione, nessun "Caricamento..." in più nelle pagine. Gli esiti delle sue richieste si trattano così:
  - **errore di rete:** interrompe il giro senza lasciare richieste del precarico in pausa e senza ritentarle. Lo stato offline e il puntino seguono le regole di oggi;
  - **altro errore non 401** (4xx, 5xx, JSON non valido): viene ignorato. La query interessata conserva i dati che aveva e non resta in uno stato d'errore che una pagina mostrerebbe dopo. Il giro prosegue con le altre query;
  - **401 di sessione:** si comporta come oggi (token rimosso, file cancellato, login) e chiude il giro.

  Ogni richiesta del precarico si fa al più una volta per giro, senza i ritenti di `retryNative`.
- **R8**: Un giro appartiene alla sessione con cui è partito. Si interrompe se il token cambia o sparisce (logout, 401, nuovo login), e dopo l'interruzione nessun dato di quel giro deve entrare nella cache in memoria né nel file.
- **R9**: Il precarico non deve produrre segnali di riposo né feedback: nessuna notifica locale programmata o cancellata, nessuna campanella, nessun aptico. Non deve leggere, scrivere né invalidare `["gym","workout","active"]`, né invalidare prefissi che la contengono (come `["gym","workout"]`).
- **R10**: Il peso della cache deve restare limitato:
  - si applicano i tetti di R4 (10 settimane salvate, 30 modelli, 20 dettagli di allenamento);
  - i dettagli di allenamenti finiti già in cache non si riscaricano;
  - alla fine di ogni giro completato si rimuovono dalla cache le query che soddisfano tutte e tre queste condizioni:
    1. appartengono alle famiglie con data o identificativo: `["diary","day",…]`, `["diary","week",…]`, `["diary","range",…]`, `["weight","range",…]`, `["gym","stats","range",…]`, `["gym","stats","progress",…]`, `["gym","workout",id]` con `id` numerico, `["gym","template",id]`, `["saved-weeks","detail",id]`;
    2. non hanno osservatori e non fanno parte del giro appena fatto;
    3. hanno `dataUpdatedAt` più vecchio di 14 giorni.

  La chiave `["gym","workout","active"]` non si tocca mai.
- **R11**: Il precarico non deve rallentare l'avvio né l'uso. Parte dopo il primo render, in differita (in idle quando disponibile, altrimenti dopo un breve ritardo), con al più 2 richieste contemporanee. Il giro deve produrre indicativamente una o due riscritture del file, non una per ogni risposta.

Schermate senza dati offline (solo IPA):

- **R12**: Nell'IPA, una schermata o sezione mostra "Non disponibile offline", con una riga di aiuto come "Aprila con la rete per averla anche offline", se valgono tutte queste condizioni:
  - lo stato di rete è offline (`isOffline()`);
  - la sua query non ha dati, oppure ha solo `placeholderData`;
  - la query non è disabilitata (`fetchStatus` diverso da `idle`).

  Il messaggio sostituisce il vuoto, il "Caricamento..." e i testi "Nessun ..." di quella parte. Deve restare stabile durante i tentativi di ripresa ogni 20 s, senza alternarsi con "Caricamento...". Header, navigazione e le altre sezioni della pagina con dati restano utilizzabili. La soluzione è uniforme: un hook e un componente condivisi, usati dalle pagine e dalle sezioni seguenti, ognuna con un solo ramo in più.
  - `web/src/pages/DayPage.tsx` (diario del giorno);
  - `web/src/pages/WeekPage.tsx` (settimana);
  - `web/src/pages/DietStatsPage.tsx` (grafici del periodo), `web/src/components/StreakCard.tsx`, `web/src/components/stats/WeightSection.tsx`;
  - `web/src/pages/SavedWeeksPage.tsx`, `web/src/pages/SavedWeekDetailPage.tsx`;
  - `web/src/pages/SearchPage.tsx` (solo la scheda "Recenti" senza testo di ricerca; la ricerca resta fuori scope);
  - `web/src/pages/AccountPage.tsx` (sezione "Sessioni attive");
  - `web/src/pages/gym/GymStartPage.tsx` (elenco modelli), `web/src/components/gym/TemplatePreviewSheet.tsx`;
  - `web/src/components/gym/ExerciseList.tsx` (pagina Esercizi e picker), `web/src/components/gym/ExerciseDetailSheet.tsx`;
  - `web/src/pages/gym/HistoryPage.tsx`, `web/src/pages/gym/WorkoutDetailPage.tsx`;
  - `web/src/pages/gym/GymStatsPage.tsx` (riepilogo del periodo), `web/src/components/WorkoutCountCard.tsx`, `web/src/components/stats/ExerciseProgressSection.tsx` (elenco esercizi e progressione);
  - `web/src/pages/gym/WorkoutPage.tsx`: riallineata allo stesso hook, mantenendo il testo "Allenamento non disponibile offline" e il link "Vai ai modelli".
- **R13**: Con la rete presente, e sempre nel browser e nella PWA, le pagine di R12 devono comportarsi esattamente come oggi.

Diagnostica e documentazione:

- **R14**: Nell'IPA, in Impostazioni, una riga discreta deve mostrare il peso e l'ora del file della cache offline, per esempio "Dati offline: circa 420 KB, salvati alle 14:05" (o "del GG/MM alle HH:MM"), letti con `Filesystem.stat` su `yfp/query-cache.json`. Senza file mostra "Dati offline: nessuno". Nel browser e nella PWA la riga non c'è.
- **R15**: Il `README.md`, sezione "iOS app (IPA)", punto "Offline, read-only", deve descrivere:
  - il puntino al posto della barra;
  - il precarico (cosa, quando, throttle, solo con rete);
  - il messaggio "Non disponibile offline";
  - il limite sui dati legati alla data: se l'ultimo giro è di ieri, offline oggi il diario di oggi e le statistiche del periodo corrente non sono disponibili.

## Requisiti non funzionali

- Prestazioni:
  - con rete, l'apertura a freddo deve mostrare la prima schermata con tempi uguali alla `v0.0.2` (indicativamente entro 2 s dall'avvio della WebView);
  - durante il giro scorrimento e tocchi restano fluidi;
  - il giro completo dura indicativamente meno di 15 s su una rete normale.
- Peso: con dati tipici (200 esercizi nel catalogo, 20 dettagli di allenamento, una decina di modelli, statistiche a 90 giorni) il file di cache deve restare indicativamente sotto 1 MB, con una stima di 300-700 KB. Il file non deve crescere senza limite con i giorni d'uso (R10).
- Traffico: al più un giro ogni 15 minuti, salvo l'apertura a freddo. Al primo giro sono al più circa 85 GET; ai giri successivi meno, perché i dettagli degli allenamenti già in cache non si riscaricano.
- Sicurezza: invariata rispetto alla feature precedente. Il file non contiene mai il token, sta in `Library` e viene cancellato al logout o dopo un 401 di sessione. Nessun dato di una sessione finita deve finire nel file di una sessione nuova (R8).
- Isolamento: tutto il nuovo comportamento è dietro `isNative()`. In jsdom (`npm test`) e nel browser i plugin nativi non vengono chiamati.

## Criteri di accettazione

Verificabili con test automatici in locale (`cd web && npm test`):

- **C1** (R1, R2): Dato il client nativo con una query osservata con dati aggiornati alle 14:05 di oggi, quando arriva `reportNetworkFailure()`, allora compare un controllo con nome accessibile che contiene "Offline, dati delle 14:05", e il testo non è visibile finché non lo si tocca. Toccandolo, il testo compare; non c'è più nessun elemento `fixed` in alto a tutta larghezza (la barra). Con dati di ieri il testo è "Offline, dati del GG/MM alle HH:MM".
- **C2** (R3): Dato il client nativo con una query osservata in pausa per `NetworkError` e un `fetch` che ora risponde 200, quando passano 20 s, allora la query viene rifatta, mostra i dati nuovi e il puntino sparisce. Lo stesso vale con `visibilitychange` → `visible`.
- **C3** (R4): Dato il client nativo con token, `["me"]` di un utente con `workouts.use` e `diary.copy`, e un `fetch` stubbato che risponde con fixture valide (storico di 25 allenamenti su due pagine, 3 modelli, 12 settimane salvate), quando parte un giro e finisce, allora:
  - la `QueryCache` contiene esattamente le chiavi di R4: 2 giorni, 1 settimana, 3 periodi dieta, 3 periodi peso, 3 periodi palestra, 3 progressioni, 3 dettagli modello, 10 dettagli di settimane salvate, 20 dettagli di allenamento;
  - `fetch` ha ricevuto le URL di R4;
  - `fetch` non ha mai ricevuto `/workouts/active`, `/foods`, `/admin`, `/auth/sessions` né `/exercises/{id}`;
  - `getQueryData(["goals"])` è `null` se `/goals` risponde 404;
  - `getQueryData(["gym","history"])` ha la forma `{ pages, pageParams }` letta da `HistoryPage`.
- **C4** (R5): Dato un giro completato, quando arriva `visibilitychange` → `visible` dopo 5 minuti (fake timers), allora `fetch` non viene chiamato; dopo 16 minuti sì. Un secondo trigger durante un giro in corso non fa partire un secondo giro. Dato un avvio a freddo con stato offline, quando arriva la prima risposta riuscita, allora il giro parte.
- **C5** (R6): Il giro non chiama `fetch` in nessuno di questi casi:
  - client web (`isNative` false);
  - token `null`;
  - `isOffline()` vero;
  - `["me"]` `null` o assente.

  Con un utente senza `workouts.use` nessuna URL della palestra viene chiamata; senza `diary.copy` nessuna URL `/saved-weeks`.
- **C6** (R7):
  - Dato un giro in cui la terza richiesta rifiuta per rete, allora nessuna richiesta successiva parte, nessuna query del precarico resta con `fetchStatus` `paused`, e nessun errore viene lanciato o mostrato.
  - Dato un giro in cui `/stats/streak` risponde 500, allora le altre query vengono caricate, `["streak"]` conserva i dati che aveva prima, e una `StreakCard` montata dopo non mostra "Impossibile caricare la serie." a causa del precarico.
  - Ogni URL viene chiamata al più una volta per giro.
- **C7** (R7, R8): Dato un giro in cui una richiesta risponde 401 `unauthorized`, allora il token è rimosso, `clearPersistedQueryCache` è chiamato, e nessuna altra richiesta del giro parte. Dato un giro in cui il token cambia da A a B a metà, allora nessuna richiesta parte più con A e le risposte arrivate dopo il cambio non compaiono nella `QueryCache`.
- **C8** (R9): Con `<NativeBridge />` montato e `@capacitor/local-notifications` e `@capacitor/haptics` mockati, quando un giro completo finisce, allora `LocalNotifications.schedule`, `LocalNotifications.cancel` e le funzioni aptiche non vengono chiamati, `getQueryData(["gym","workout","active"])` è `undefined`, e nessuna `invalidateQueries` con prefisso `["gym","workout"]` viene eseguita.
- **C9** (R10):
  - Dato in cache `["gym","workout",7]` con dati, quando un giro trova l'allenamento 7 nella prima pagina, allora `/workouts/7` non viene chiamato.
  - Date in cache, senza osservatori, `["diary","day","2026-09-01"]` aggiornata 20 giorni prima e `["diary","day",X]` aggiornata 3 giorni prima, quando un giro finisce, allora la prima viene rimossa e la seconda resta.
  - Una query con osservatori resta comunque.
  - `["gym","workout","active"]` non viene mai toccata.
- **C10** (R11): Quando il client nativo monta `App`, allora `fetch` non riceve richieste del precarico prima del primo render né prima della risposta di `/auth/me`. Durante il giro le richieste del precarico in volo nello stesso momento non sono mai più di 2. Un giro completo con `Filesystem.writeFile` mockato produce al più 2 scritture.
- **C11** (R12): Con `isNative` true, `reportNetworkFailure()` e la query della pagina in pausa senza dati, ciascuna pagina e sezione di R12 mostra "Non disponibile offline" e non mostra "Caricamento...", "Nessun ...", né il messaggio d'errore della pagina. Dopo `retryConnection()`, con la query di nuovo in `fetching`, il messaggio resta e non compare "Caricamento...". In `ExerciseList`, una query con `isPlaceholderData` vero, offline, mostra lo stesso messaggio. In `DietStatsPage`, con il diario del periodo in cache ma senza `["streak"]`, compaiono i grafici e il messaggio nella sola `StreakCard`.
- **C12** (R13): Con `isNative` false, oppure in nativo con `isOffline()` falso, le stesse pagine con la query in pausa o in caricamento si comportano come oggi. I test esistenti delle pagine passano senza modifiche:
  - `DayPage.test.tsx`, `WeekPage.test.tsx`, `WeekPage.savedWeeks.test.tsx`, `DietStatsPage.test.tsx`;
  - `SavedWeeksPage.test.tsx`, `SavedWeekDetailPage.test.tsx`, `SearchPage.test.tsx`, `SettingsPage.test.tsx`;
  - `gym/HistoryPage.test.tsx`, `gym/WorkoutDetailPage.test.tsx`, `gym/GymStatsPage.test.tsx`, `gym/WorkoutPage.test.tsx`;
  - `StreakCard.test.tsx`, `WorkoutCountCard.test.tsx`, `ExercisePicker.test.tsx`.

  `gym/WorkoutPage.offline.test.tsx` passa, modificato al massimo per il nuovo hook.
- **C13** (R14): Con `isNative` true e `Filesystem.stat` mockato (`size` 430080, `mtime` alle 14:05 di oggi), `SettingsPage` mostra "Dati offline: circa 420 KB, salvati alle 14:05". Con `stat` che rifiuta mostra "Dati offline: nessuno". Con `isNative` false la riga non c'è e `Filesystem` non viene chiamato.

Verificabili con comandi o ispezione dei file:

- **C14** (R15): `grep -n "Non disponibile offline" README.md` trova almeno una riga nella sezione iOS. Il punto "Offline, read-only" non descrive più una barra e descrive il puntino, il precarico con il throttle di 15 minuti e il limite dei dati legati alla data.
- **C15** (non regressione dei tipi): eseguendo `cd web && npx tsc -b`, non ci sono errori.

Verificabili solo sul dispositivo (iPhone, iOS 26, SideStore, IPA del nuovo tag):

- **C16** (R4, R5, R12): Installata l'IPA, si fa login con rete e si apre solo "Giorno", senza visitare altre schermate. Dopo circa 30 s si chiude l'app dal multitasking, si attiva la modalità aereo e la si riapre. Si aprono:
  - Giorno (oggi e ieri), Settimana, Statistiche dieta (7, 30 e 90 giorni, con streak, obiettivo e peso), Settimane salvate e il dettaglio della più recente;
  - Inizia (modelli e anteprima di un modello), Esercizi, Storico e il dettaglio di uno degli ultimi 20 allenamenti, Statistiche palestra (7, 30 e 90 giorni, con il conteggio e la progressione dell'esercizio predefinito);
  - Impostazioni.

  Tutte mostrano dati. Un giorno di 3 giorni prima, il dettaglio di un allenamento più vecchio dei 20, la scheda di un esercizio del catalogo e "Cerca" mostrano "Non disponibile offline". Nessuna schermata resta vuota o in "Caricamento..." per più di qualche secondo.
- **C17** (R1, R2): In modalità aereo, su Giorno, Settimana, Storico, dettaglio allenamento, Statistiche e Impostazioni, il puntino:
  - è visibile;
  - non copre status bar, Dynamic Island, pulsante peso, interruttore Dieta/Palestra, ingranaggio, frecce, titoli né tab bar, e la loro posizione non cambia in modo percepibile rispetto all'app con rete;
  - al tocco mostra "Offline, dati delle HH:MM" e il testo si chiude da solo.

  Disattivata la modalità aereo, il puntino sparisce.
- **C18** (R11): Con rete, l'apertura a freddo mostra "Giorno" con tempi non peggiori della `v0.0.2` (indicativamente entro 2 s), e nei primi 15 s scorrimento e cambio di tab restano fluidi.
- **C19** (R10, R14): In Impostazioni, dopo C16, si annota nel registro del piano il peso mostrato (atteso indicativamente sotto 1 MB) e l'ora. Si riapre l'app dopo qualche minuto e dopo più di 15 minuti con rete: si annotano peso e ora a ogni passo. L'ora cambia, il peso resta dello stesso ordine di grandezza.

Comportamenti da preservare:

- **C20** (preservare): Dato il browser o la PWA, quando la rete manca, allora non c'è nessun puntino né messaggio "Non disponibile offline", e `fetch` non riceve richieste di precarico. `createQueryClient(false).getDefaultOptions()` non ha `queries` né `mutations`. I test `web/src/auth/AuthGuard.test.tsx`, `web/src/auth/AuthGuard.offline.test.tsx`, `web/src/auth/AuthContext.test.tsx`, `web/src/api/client.test.ts`, `web/src/api/weights.test.tsx` e `web/src/api/savedWeeks.test.tsx` passano senza modifiche.
- **C21** (preservare): Dato il client nativo con rete, quando `/auth/me` o una richiesta del precarico riceve 401 `unauthorized` per il token corrente, allora il token è rimosso, il file cancellato e l'app è su `/login`. I test `web/src/auth/AuthGuard.native.test.tsx`, `web/src/api/client.errors.native.test.ts`, `web/src/api/client.native.test.ts` e `web/src/api/auth.native.test.ts` passano senza modifiche.
- **C22** (preservare): Dato il client nativo, quando una richiesta (pagina o precarico) rifiuta per rete o riceve 500, 502 o una risposta non JSON, allora il token resta, il file non viene cancellato e non avviene nessuna navigazione verso `/login`. I casi di `client.errors.native.test.ts` e di `queryPersistence.test.ts` passano senza modifiche.
- **C23** (preservare): Senza token nessuna scrittura del file avviene, nemmeno a fine giro di precarico. I casi esistenti di `web/src/native/queryPersistence.test.ts` passano senza modifiche.
- **C24** (preservare): `web/src/native/boot.test.ts`, `web/src/native/queryPersistence.restore.native.test.tsx` e i casi C1 e C2 di `AuthGuard.native.test.tsx` passano senza modifiche. Sul dispositivo, nella prova C16, l'app riaperta in modalità aereo entra senza login e senza "Impossibile contattare il server".
- **C25** (preservare): I test `web/src/native/restNotifications.test.ts`, `web/src/native/NativeBridge.test.tsx`, `web/src/native/haptics.test.ts`, `web/src/components/gym/RestTimerBar.test.tsx`, `web/src/components/gym/RestTimerBar.native.test.tsx`, `web/src/lib/push.test.ts` e `web/src/components/RestAlertSetting.test.tsx` passano senza modifiche. Sul dispositivo, con un riposo avviato con avviso attivo, mandando l'app in background e riportandola in primo piano dopo 15 minuti (giro di precarico), la notifica arriva una sola volta all'ora prevista e non ci sono vibrazioni né campanella in più.
- **C26** (preservare): Tutti i casi del vecchio `OfflineBar.test.tsx` restano coperti per l'indicatore nuovo:
  - visibile offline con dati;
  - nascosto dopo `reportNetworkSuccess()`;
  - assente con rete e sul web;
  - formato di ieri;
  - `["me"]` esclusa dall'ora se ci sono altre query, usata se è l'unica;
  - evento `offline` della finestra;
  - ripresa a 20 s.

  Le asserzioni cambiano solo dove il testo è ora dietro il tocco.
- **C27** (preservare): Dato il client nativo offline, quando si prova una scrittura (per esempio aggiungere cibo), allora fallisce subito con l'errore della schermata e non resta in coda. Il test della mutazione nativa offline in `web/src/lib/queryClient.test.ts` passa senza modifiche.

Non regressione:

- **C28** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano, anche quelli esistenti.

## Fuori scope

- Palestra offline completa: stato locale dell'allenamento, reducer client, outbox, sync a blocco, `PUT /workouts/{uuid}` idempotente (ADR 0004).
- Scritture offline di qualsiasi tipo e coda delle mutazioni.
- Ricerca cibo, "Recenti" e barcode offline: restano fuori dalla persistenza e dal precarico.
- Precarico di: scheda del singolo esercizio del catalogo, ricerche e filtri esercizi, periodi personalizzati delle statistiche, progressione di esercizi diversi da quello predefinito, giorni diversi da oggi e ieri, settimane diverse dalla corrente, pagine successive dello storico, sessioni di Account, connessioni MCP, pagine admin.
- Precarico nel browser e nella PWA.
- Distinzione tra Wi-Fi e rete cellulare (servirebbe un plugin nativo).
- Live Activity e Dynamic Island, HealthKit, APNs.
- Suono personalizzato della notifica di fine riposo (`rest-bell.wav`).
- Isolamento dei test pytest.
- Bug preesistente di `AuthProvider`: sta sopra `<Routes>` e, dopo `queryClient.clear()` (logout o `LoginPage.finish()`), il suo observer di `["me"]` resta legato alla query rimossa, quindi `useHasPermission` e `useIsAdmin` vedono l'account precedente fino al riavvio (anche sul web). Resta un follow-up ([review della feature precedente](../2026-10-12-ipa-apertura-offline/review.md), "Follow-up"). Nota: R6 legge i permessi da `["me"]` nella `QueryCache`, non dal contesto, quindi il precarico non eredita il bug.
- Gli avvisi della review precedente non legati al precarico: ciclo di import `client.ts` → `queryPersistence.ts` → `api/gym.ts`, `retryNative` che ritenta i 4xx nelle pagine, riscrittura del file a ogni tentativo offline di 20 s.

## Rischi

- **Crescita della cache con `gcTime: Infinity`.** Le chiavi con data (giorno, periodi delle statistiche) cambiano ogni giorno, e senza pulizia il file crescerebbe a ogni uso. Mitigazione: R10 (pulizia a 14 giorni delle sole query inattive), C9 e C19. La pulizia non contraddice la decisione "nessuna età massima" della feature precedente, che riguarda la validità dei dati e non il loro accumulo.
- **Dati legati alla data.** Se l'ultimo giro risale a ieri, offline oggi le chiavi di oggi (diario di oggi, periodi che finiscono oggi) non sono in cache e compare "Non disponibile offline", mentre il diario di "ieri" c'è. È un limite accettato, documentato in R15.
- **Dati di un'altra sessione.** Una risposta del precarico arrivata dopo un logout o un nuovo login potrebbe ripopolare la cache con i dati vecchi. Mitigazione: R8 e C7.
- **Precarico in pausa o ritentato.** Con `retryNative`, un `NetworkError` metterebbe in pausa le richieste del precarico, che ripartirebbero da sole, e i 4xx verrebbero ritentati 3 volte. Mitigazione: R7 (una sola richiesta per query, interruzione su errore di rete) e C6.
- **Prefisso condiviso `["gym","workout"]`.** Toccare quel prefisso coinvolgerebbe l'allenamento attivo e farebbe scattare `NativeBridge`. Mitigazione: R9 e C8.
- **Traffico e batteria.** Un giro arriva fino a circa 85 GET. Mitigazione: throttle di 15 minuti, al più 2 richieste contemporanee, nessun nuovo download dei dettagli di allenamenti finiti.
- **Idle nella WKWebView.** `requestIdleCallback` potrebbe non essere disponibile in WKWebView. Mitigazione: R11 prevede un ritardo di riserva; verifica in C18.
- **Posizione del puntino.** Le pagine hanno header diversi (con o senza `ModeSwitch`, `SettingsPage` senza interruttore per chi non ha la palestra), e lo spazio libero nella riga di `ModeSwitch` su un iPhone stretto è poco. Mitigazione: R1 vincola il risultato e C17 lo verifica pagina per pagina; vedi la domanda aperta 4.
- **Messaggio "Non disponibile offline" sopra dati validi.** Se la condizione fosse sbagliata, una pagina con dati in cache mostrerebbe il messaggio. Mitigazione: R12 richiede assenza di dati (o solo placeholder) e query non disabilitata; C11 e C12 lo verificano.
- **Peso misurabile solo dall'app.** Senza Mac, il file in `Library` non è ispezionabile dal dispositivo. Mitigazione: R14 e C19.

## Decisioni prese con l'utente

- Throttle: 15 minuti tra un giro e l'altro al ritorno in primo piano o al ritorno della rete; l'apertura a freddo fa sempre un giro.
- Statistiche: tutti e tre i preset (7, 30, 90 giorni) per diario, peso e palestra, più la progressione del solo esercizio predefinito per i tre preset.
- Puntino: nella riga superiore dell'header, accanto all'interruttore Dieta/Palestra, e negli header di `WorkoutDetailPage` e `WorkoutPage`; ambra, 8-10 px, area di tocco di circa 44 px.
- Riga diagnostica in Impostazioni (R14): sì, sempre visibile nell'IPA.
- Tetti del precarico (proposta predefinita, non contestata): dettagli dei 20 allenamenti della prima pagina dello storico, primi 30 modelli, 10 settimane salvate più recenti, pulizia delle query con data inattive più vecchie di 14 giorni.

## Domande aperte

Nessuna.
