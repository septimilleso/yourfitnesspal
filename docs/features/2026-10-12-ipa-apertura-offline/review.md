# Review: IPA, apertura offline con dati in cache, icona e correzioni della feature 1

- Data: 2026-10-13
- Round: 2
- Verdetto: APPROVED
- Diff: `2e18773..feature/ipa-apertura-offline` (T1–T17) (esclusi `docs/` e `.claude/`)
- Reviewer: devflow-reviewer (opus/medium)

## Criteri di accettazione

| Criterio | Esito | Note |
|---|---|---|
| C1 | OK | `AuthGuard.native.test.tsx`: con dati in cache e fetch che rifiuta, contenuto protetto; `["me"]` in pausa con dati porta all'`Outlet`. |
| C2 | OK | Senza `me` in cache: "Impossibile contattare il server", token intatto. Senza token: login. |
| C3 | OK | Token intatto, cache persistente non cancellata; dopo T15 un 5xx o una risposta non JSON non toglie più le query dal file né le fa tornare in errore (round 1: era MAJOR). |
| C4 | OK | Il client rimuove token e file solo se `getToken() === token`; `SessionEnded` svuota la memoria e porta a `/login`. |
| C5 | OK | `queryClient.test.ts` e `OfflineBar.test.tsx`. |
| C6 | OK | `gymKeys.active` escluso in scrittura e ripristino. Le asserzioni su schedule/cancel non sono discriminanti (MINOR di T10). |
| C7 | OK | |
| C8 | OK (riportato) | Il test copre l'ordine delle chiamate; la garanzia sta nella coda di `restNotifications.ts:65-79`. |
| C9 | OK | `clearToken` azzera la memoria prima di `Preferences.remove`. |
| C10 | OK | |
| C11 | OK (statico) | 1024x1024 RGB, `Contents.json` invariato, placeholder sparito, `web/public` invariato. |
| C12 | OK | `ref: ${{ env.TAG }}` sul checkout; `VITE_BUILD_ID` = tag. |
| C13 | OK | "Network required" assente; nota "Offline, read-only" e punto 4 di Releasing aggiornati. |
| C14 | non verificabile qui | T14. Staticamente il checkout fallisce su tag assente prima del passo di release. |
| C15 | non verificabile qui | T14 |
| C16 | non verificabile qui | T14. Ritaglio stretto: giudizio visivo. |
| C17 | non verificabile qui | T14. Vedi MINOR 2, 3, 5. |
| C18 | non verificabile qui | T14 |
| C19 | non verificabile qui | T14 |
| C20 | non verificabile qui | T14 |
| C21 | OK | Ramo web di `AuthGuard` identico; `QueryClient` web senza `defaultOptions`; test protetti invariati. |
| C22 | OK | Unico test toccato: `AuthContext.restAlerts.test.tsx` (1 → 2 cancellazioni, ammesso da R11). |
| C23 | OK | |
| C24 | OK (riportato) | Da T13. |
| C25 | non verificabile qui | T14 |
| C26 | OK | 563 di 563. |
| C27 | OK | Dopo T16 l'evento `offline` della WebView accende la barra e l'ora esclude `["me"]`. Resta da vedere su dispositivo se la barra copre ~20 px di header (C17). |

## Test

`cd web && npm test`: 86 file, 563 test passati, 0 falliti.
`cd web && npx tsc -b`: nessun errore.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- Nessuno (il MAJOR del round 1, persistenza delle query in errore 5xx, è chiuso da T15)

### MINOR
- `web/src/components/OfflineBar.tsx:40-43` — La barra `fixed top-0 z-50` può coprire circa 20 px della `.app-header` sticky (switch dieta/palestra) quando è visibile. Da verificare in C17 sul dispositivo; se coperta, mettere la barra nel flusso o aggiungere padding all'header.
- Chiusi dopo il round 1: evento `offline` (T16), ora della barra senza `["me"]` (T16), ricerche e dimensione della cache (T17).
- Annotati nel registro del piano e accettati senza task: `WorkoutPage.tsx:86` (`!workout` vale anche per `null`), `boot.ts` (cache cancellata se `loadNativeSession` rifiuta), test C8 che copre solo l'ordine, `queryClient.test.ts:68` (controlli aggiuntivi su `foods`), ritenti di `useLiveMutation` offline.

## Note

La feature è completa. Avvisi (non bloccanti):
- avviso nuovo: `lib/retry.ts:4` — `retryNative` ritenta 3 volte anche i 4xx, compreso il 401 delle query diverse da `["me"]`: il client rimuove subito token e file, ma il redirect arriva dopo ~7 s e nel frattempo le richieste partono senza Authorization. Vale anche con il `retry` di default (non è una regressione). Escludere `ApiError` con `status < 500` è economico.
- avviso nuovo: caso limite R13. Una `/auth/me` partita col token A che riceve 401 dopo un nuovo login col token B non tocca B, ma `NativeGuard` vede l'errore 401 su `["me"]` e rende `SessionEnded` (`clear()` più `/login`). Poco probabile (il login avviene con `AuthGuard` smontato e `finish()` fa `clear()`).
- avviso nuovo: R12 vale "nella stessa esecuzione". Se `Preferences.remove` fallisce durante un logout offline, al riavvio il token viene ricaricato e l'utente risulta di nuovo loggato. Accettato dalla spec; da annotare.
- avviso nuovo: ciclo di import `client.ts` → `queryPersistence.ts` → `api/gym.ts` → `client.ts`. Sicuro oggi; basta un `class X extends ApiError` o un `const` a livello di modulo in `gym.ts`/`lib/gym.ts` per un TDZ. Si spezza definendo la chiave `["gym","workout","active"]` in `queryPersistence.ts` (o in un modulo `keys` senza dipendenze).
- avviso nuovo: `retryOnlyNetwork` sta in `lib/queryClient.ts`; importare `AuthContext` crea il `QueryClient` singleton come effetto collaterale. Spostarlo in `lib/retry.ts` toglie l'effetto.
- avviso nuovo: la scrittura debounced si riarma a ogni evento della `QueryCache`. Offline, ogni 20 s `retryConnection` fa partire fetch fallite e una riscrittura completa con gli stessi dati. Innocuo, ma pesa insieme al MINOR sulla dimensione. Si potrebbe saltare la scrittura se nessun `dataUpdatedAt` è cambiato.
- avviso nuovo: con T15 una query con dati che riceve un 404/403 permanente (es. settimana salvata cancellata da un altro dispositivo) viene comunque persistita come riuscita e offline mostra l'ultimo dato visto; accettabile in sola lettura (si può escludere un `ApiError` 4xx in `queryPersistence.ts:46-48`).
- avviso nuovo: le ricerche esercizi con `q` restano in memoria con `gcTime: Infinity` (fuori dal file); `setQueryDefaults(["gym","exercises"])` toglierebbe dalla memoria anche il catalogo, da valutare in una feature successiva.
- avviso nuovo: un evento `offline` spurio della WebView accende la barra fino alla prima risposta HTTP; la correggono il tentativo di ripresa a 20 s, il primo piano o qualunque richiesta.
- avviso nuovo: caso limite dopo `offline`+`online` senza fetch (solo query fresche): la barra resta finché una navigazione fa partire una richiesta; eventuale `invalidateQueries(["me"])` in `onOnline`. Da confermare in C17.
- avviso nuovo: offline e senza dati in cache, diario, settimana, statistiche e dettaglio allenamento restano con l'header e nessun contenuto (`isLoading` e `isError` falsi in pausa). Nessun crash (verificato su `DayPage`, `WeekPage`, `DietStatsPage`, `HistoryPage`, `WorkoutDetailPage`); la barra compare grazie a `["me"]`. Rientra nel "vuoto" ammesso da R2.

Follow-up fuori da questa feature:
- `AuthProvider` sta sopra `<Routes>`: dopo `queryClient.clear()` (logout o `LoginPage.finish()`) il suo observer di `["me"]` resta sulla query rimossa; `useIsAdmin`/`useHasPermission` vedono i permessi dell'account precedente fino al riavvio, anche sul web. Preesistente e non peggiorato dalla feature (confermato con test di prova in T13).
- Suono personalizzato della notifica di fine riposo (`rest-bell.wav`), isolamento dei test pytest: restano aperti dalla feature 1.
- T14 (CI e prove sull'iPhone, C14–C20 e C25) da eseguire dopo il merge.
