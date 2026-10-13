# Review: IPA, precarico offline, puntino discreto e messaggio "Non disponibile offline"

- Data: 2026-10-13
- Round: 1
- Verdetto: CHANGES_REQUESTED
- Diff: `d3e58d6..feature/ipa-precarico-offline` (esclusi `docs/` e `.claude/`)
- Reviewer: devflow-reviewer (opus/medium)

## Criteri di accettazione

| Criterio | Esito | Note |
|---|---|---|
| C1 | OK | Pulsante con `aria-label`, fumetto solo dopo il tocco, nessun elemento `fixed`. Copertura di R1 incompleta in `SearchPage` (vedi MAJOR). |
| C2 | OK | Ripresa a 20 s e su `visible` in `OfflineIndicator.test.tsx`. |
| C3 | OK | Chiavi, URL e funzioni identiche a quelle delle pagine; `goals` 404 → `null`; storico `{pages,pageParams:[null]}`. |
| C4 | OK | Throttle a 5 e 16 minuti, un giro alla volta, avvio offline seguito dal ritorno della rete. |
| C5 | OK | Web, senza token, offline, `me` null, senza permessi, admin. |
| C6 | OK | Chiamate dirette senza `retryNative`: nessuna pausa, nessuno stato `error`; il 500 su streak conserva i dati. |
| C7 | OK | 401 e cambio token testati; "risposta in volo dopo 401 non entra in cache" garantito da `alive()` in `set`, senza test dedicato. |
| C8 | OK | Nessuna invalidazione di `["gym","workout"]`; `active` mai letta né scritta. |
| C9 | OK | Dettagli già in cache non riscaricati; pulizia a 14 giorni; query osservate tenute; `active` esclusa. |
| C10 | OK | Al più 2 richieste in volo, 1 scrittura per giro. Il test d'integrazione non distingue "2 s dalla risposta di /auth/me" da "dal mount"; lo copre il test unitario dello scheduler. |
| C11 | OK | Tutte le pagine e sezioni di R12; messaggio stabile in `fetching`; placeholder in `ExerciseList`. |
| C12 | OK | Test esistenti invariati e verdi; `WorkoutPage.offline.test.tsx` modificato come consentito. |
| C13 | OK | Per altra data il testo è "salvati il GG/MM alle" (deviazione decisa nel piano, T18). |
| C14 | OK | README aggiornato; nessuna barra descritta. |
| C15 | OK | `tsc -b` senza errori. |
| C16 | non verificabile qui | Staticamente le chiavi precaricate coincidono con quelle delle pagine. |
| C17 | non verificabile qui | Restano gli avvisi su spostamento orizzontale, 360 px e il puntino mancante in Cerca. |
| C18 | non verificabile qui | Giro in differita dopo `/auth/me`. |
| C19 | non verificabile qui | Annotare peso del file con e senza `diary.copy`. |
| C20 | OK | Tutto dietro `isNative()`; QueryClient web invariato. |
| C21 | OK | Il client toglie token e file; il giro mette `["me"]` a `null` e si chiude. |
| C22 | OK | 502 e non JSON non toccano la sessione. |
| C23 | OK | `writeCache` controlla il token. |
| C24 | OK (parte automatica) | Test invariati e verdi; parte sul dispositivo in attesa. |
| C25 | OK (parte automatica) | Idem. |
| C26 | OK | Tutti i casi del vecchio `OfflineBar.test` sono in `OfflineIndicator.test.tsx`. |
| C27 | OK | `networkMode: "always"` invariato. |
| C28 | OK | 788/788. |

## Test

`cd web && npm test`: 108 file, 788 test passati, 0 falliti.
`cd web && npx tsc -b`: nessun errore.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- `web/src/pages/SearchPage.tsx:97` — "Aggiungi alimento" è una schermata autenticata con header ma non ha il puntino (non usa `ModeSwitch`, non ha `OfflineIndicator`). R1 chiede il puntino in ogni schermata autenticata con un header; il piano esclude esplicitamente solo `TemplateEditorPage` e `AdminUsersPage`. Nella v0.0.2 la barra compariva anche qui: rottura non dichiarata. Offline la scheda Recenti mostra sempre "Non disponibile offline". Correzione: `h1` e `<OfflineIndicator className="relative -my-2.5 inline-flex shrink-0" />` in un `flex items-center gap-1`, come in `SettingsPage`, e un caso in `ModeSwitch.native.test.tsx`.

### MINOR
- `web/src/native/prefetchScheduler.ts:44` — `lastCompletedAt` non dipende dalla sessione: dopo logout o 401 e nuovo login entro 15 minuti dall'ultimo giro, la cache svuotata non viene precaricata finché non passano 15 minuti e arriva un ritorno in primo piano o della rete. Correzione: salvare il token del giro completato e trattare `lastCompletedAt` come `null` se `getToken()` è diverso. Merita un task piccolo.
- `web/src/native/cachePrune.ts:48` — (già annotato in T5) viene rimossa anche una query senza dati (`dataUpdatedAt` 0) e senza osservatori, compresa una in `fetching`. Correzione di una riga: `if (dataUpdatedAt === 0 || fetchStatus === "fetching") continue;` da accorpare al task del MINOR precedente.
- `web/src/native/prefetchScheduler.ts:35-46` — R6 vieta il precarico sulle pagine non autenticate (login, `/connect`) ma non c'è un controllo di route; su `/login` manca il token, su `/connect` con token e `me` il giro può partire. Nell'IPA `/connect` è praticamente irraggiungibile: documentare come accettato.
- `web/src/native/prefetch.ts:163-177` — con la coda vuota un lavoratore esce anche se l'altro sta producendo figli: sulle code finali la concorrenza scende a 1 (solo più lento, al più gli ultimi 10 dettagli). Nessun task.
- `web/src/components/ModeSwitch.tsx:48-51` — il puntino nel flusso sposta di ~16 px il gruppo Dieta/Palestra quando compare: al limite di R1. Da giudicare in C17 sull'iPhone; se percepibile, un segnaposto invisibile della stessa larghezza a sinistra.
- `web/src/components/OfflineUnavailable.tsx:12,19` — la riga di aiuto "Aprila con la rete..." è poco adatta al picker esercizi (prop opzionale più avanti).
- `web/src/components/OfflineCacheInfo.tsx:34` — sotto 512 byte mostra "circa 0 KB".

## Note

La feature è completa; il verdetto dipende dal puntino mancante in Cerca. Avvisi nuovi (non bloccanti):
- avviso nuovo: corsa tra precarico e scritture della pagina (`prefetch.ts:62-69`). Il giro non passa da `fetchQuery`, quindi `invalidateQueries` non annulla le sue richieste: una GET del precarico partita prima di una mutazione e arrivata dopo il refetch dell'invalidazione sovrascrive il dato nuovo con quello vecchio fino al prossimo refetch o giro. Finestra stretta (rete lenta). Si potrebbe saltare `set` se la query è in `fetching` o `dataUpdatedAt` è successivo all'inizio della richiesta.
- avviso nuovo: peso del file stimato 300-700 KB, sbilanciato verso le settimane salvate (10 dettagli da 7 giorni); riscritto intero con `JSON.stringify` sul thread principale, anche a ogni tentativo offline ogni 20 s. In C19 annotare il peso con e senza `diary.copy`.
- avviso nuovo: `useOfflineUnavailable` in `WorkoutPage` dipende da `isOffline()`; se WKWebView non emette `offline` e nessuna fetch fallisce ancora, si vede "Caricamento..." finché la richiesta non fallisce. Da guardare in C16/C17.

Follow-up fuori da questa feature: ricerca cibo con testo offline mostra "Nessun risultato." (R12 la escludeva); tab Recenti sempre non disponibile offline (chiavi `foods*` non persistite); bug preesistente `AuthProvider`/`["me"]` dopo `queryClient.clear()` (non peggiorato); T21 (verifica sul dispositivo, C16-C19, C24, C25) dopo merge e tag.
