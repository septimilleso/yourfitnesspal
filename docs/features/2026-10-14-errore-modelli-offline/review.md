# Review: Errore "Errore nel caricamento dei modelli." in modalità aereo nell'IPA

- Data: 2026-10-14
- Round: 1
- Verdetto: APPROVED
- Diff: `dda4bbc..d0f4897`
- Reviewer: devflow-reviewer (opus/medium)

## Criteri di accettazione

| Criterio | Esito | Note |
|---|---|---|
| C1 | OK | Modelli con dati: `success` e "Modello 1" visibile. Senza dati: "Non disponibile offline". Storico coperto da `HistoryPage.offlineError.native.test.tsx`; `DayPage` senza test, il criterio dice "per esempio". |
| C2 | OK | Test `GymStartPage.offlineError.native.test.tsx` esegue i passi della spec e verifica testo e `status`. Copre anche 502 (resta `error`, dati conservati) e 401 (`["me"]` a `null`). `queryClient.test.ts` e `OfflineIndicator.test.tsx` non modificati e verdi. |
| C3 | OK | Suite completa verde. |
| C4 | Pendente | Verifica su iPhone (task T4, manuale) ancora da fare. |

## Test

`cd web && npm test`: 110 file, 799 test passati, 0 falliti.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- Nessuno

### MINOR
- `web/src/pages/gym/GymStartPage.offlineError.native.test.tsx:86-90` — `waitFor(() => expect(fetchMock).toHaveBeenCalled())` passa anche con la sola fetch di `useActiveWorkout`, quindi non dimostra che la query dei modelli sia ripartita. `getByText("Non disponibile offline")` sta fuori da `waitFor`. Aspettare `templatesFetchStatus() === "paused"` dopo il nuovo render e usare `findByText`.
- `web/src/pages/gym/GymStartPage.offlineError.native.test.tsx:83` — il commento "al ritorno della rete non parte nulla" non è verificato da nessuna asserzione. Aggiungere `expect(fetchMock).not.toHaveBeenCalled()` dopo `retryConnection()` oppure riformulare il commento.
- `docs/features/2026-10-14-errore-modelli-offline/spec.md`, "Correzione proposta" — la spec dice che `isInvalidated` "resta". In realtà diventa `true` perché il dispatch `error` lo imposta prima di `onError` e lo spread lo conserva. L'effetto voluto (refetch al montaggio) c'è comunque. Correggere il testo della spec.

## Note

- La correzione in `web/src/lib/queryClient.ts:18-21` agisce sulla causa radice (retryer annullato allo smontaggio che rifiuta con `NetworkError` su query con dati), non sul sintomo. In react-query 5.102.5 `onError` della cache gira subito dopo il dispatch `error`, nello stesso tick, quindi `setState` sovrascrive lo stato prima della notifica agli osservatori.
- Gli "Altri punti colpiti" sono coperti dalla correzione generale, comprese le query infinite. Web e PWA invariati (ramo dietro `native`). Errori HTTP e 401 invariati. Nessuna rottura non dichiarata: i sottoscrittori della cache (`NativeBridge.tsx:24`, `prefetchScheduler.ts:101`) reagiscono solo ad `action.type === "success"`.
- avviso nuovo: la query corretta conserva `errorUpdateCount` ed `errorUpdatedAt` aggiornati dal dispatch `error`. Nessuno li legge oggi; da ricordare se si userà `errorUpdatedAt`.
- avviso nuovo: chi chiama `fetchQuery` riceve ancora il rifiuto con `NetworkError` (il `throw` dopo `onError` resta). Comportamento invariato; le pagine usano `useQuery`.
- Follow-up: T4 su iPhone (C4) dopo la build dell'IPA. Se l'errore compare senza lasciare la schermata, vedi ipotesi (a) nella spec.
