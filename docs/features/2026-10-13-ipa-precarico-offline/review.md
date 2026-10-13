# Review: IPA, precarico offline, puntino discreto e messaggio "Non disponibile offline"

- Data: 2026-10-13
- Round: 2
- Verdetto: APPROVED
- Diff: `d3e58d6..feature/ipa-precarico-offline` (T1-T23, esclusi `docs/` e `.claude/`)
- Round 1 (CHANGES_REQUESTED): 1 MAJOR (puntino mancante in "Aggiungi alimento") e 2 MINOR (throttle non legato alla sessione, pulizia di query vuote o in fetch), chiusi dai task T22 e T23 e verificati al round 2.
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

`cd web && npm test`: 108 file, 794 test passati, 0 falliti (round 2).
`cd web && npx tsc -b`: nessun errore.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- Nessuno (il MAJOR del round 1, puntino mancante in `SearchPage`, è chiuso da T22).

### MINOR
- Chiusi dal round 1: throttle legato alla sessione e pulizia più prudente (T23).
- `web/src/native/prefetchScheduler.ts:35-46` — R6 vieta il precarico sulle pagine non autenticate (login, `/connect`) ma non c'è un controllo di route; su `/login` manca il token, su `/connect` con token e `me` il giro può partire. Nell'IPA `/connect` è praticamente irraggiungibile: documentare come accettato.
- `web/src/native/prefetch.ts:163-177` — con la coda vuota un lavoratore esce anche se l'altro sta producendo figli: sulle code finali la concorrenza scende a 1 (solo più lento, al più gli ultimi 10 dettagli). Nessun task.
- `web/src/components/ModeSwitch.tsx:48-51` — il puntino nel flusso sposta di ~16 px il gruppo Dieta/Palestra quando compare: al limite di R1. Da giudicare in C17 sull'iPhone; se percepibile, un segnaposto invisibile della stessa larghezza a sinistra.
- `web/src/components/OfflineUnavailable.tsx:12,19` — la riga di aiuto "Aprila con la rete..." è poco adatta al picker esercizi (prop opzionale più avanti).
- `web/src/components/OfflineCacheInfo.tsx:34` — sotto 512 byte mostra "circa 0 KB".

## Note

La feature è completa. Su iPhone controllare anche "Aggiungi alimento" (C17): il puntino accanto al titolo non deve spostare il pulsante di scansione né allungare la riga; a 320 px il titolo più puntino può andare su due righe. Avvisi (non bloccanti):
- avviso nuovo: corsa tra precarico e scritture della pagina (`prefetch.ts:62-69`). Il giro non passa da `fetchQuery`, quindi `invalidateQueries` non annulla le sue richieste: una GET del precarico partita prima di una mutazione e arrivata dopo il refetch dell'invalidazione sovrascrive il dato nuovo con quello vecchio fino al prossimo refetch o giro. Finestra stretta (rete lenta). Si potrebbe saltare `set` se la query è in `fetching` o `dataUpdatedAt` è successivo all'inizio della richiesta.
- avviso nuovo: peso del file stimato 300-700 KB, sbilanciato verso le settimane salvate (10 dettagli da 7 giorni); riscritto intero con `JSON.stringify` sul thread principale, anche a ogni tentativo offline ogni 20 s. In C19 annotare il peso con e senza `diary.copy`.
- avviso nuovo: `useOfflineUnavailable` in `WorkoutPage` dipende da `isOffline()`; se WKWebView non emette `offline` e nessuna fetch fallisce ancora, si vede "Caricamento..." finché la richiesta non fallisce. Da guardare in C16/C17.

Follow-up fuori da questa feature: ricerca cibo con testo offline mostra "Nessun risultato." (R12 la escludeva); tab Recenti sempre non disponibile offline (chiavi `foods*` non persistite); bug preesistente `AuthProvider`/`["me"]` dopo `queryClient.clear()` (non peggiorato); T21 (verifica sul dispositivo, C16-C19, C24, C25) dopo merge e tag.
