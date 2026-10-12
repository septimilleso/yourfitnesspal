# Review: IPA shell iOS

- Data: 2026-10-12
- Round: 1
- Verdetto: APPROVED
- Diff: `424522c..feature/ipa-shell-ios` (esclusi `docs/` e `.claude/`)
- Reviewer: devflow-reviewer (opus/medium)

## Criteri di accettazione

| Criterio | Esito | Note |
|---|---|---|
| C1 | OK | `basePath()` usa `VITE_API_BASE_URL` o `/api`. `client.test.ts` e `client.native.test.ts` verdi, `init` sul web invariato. |
| C2 | OK | In nativo Bearer, `X-Requested-With`, `credentials: omit`; token rimosso su 401 `unauthorized`, mai sul web. Resta il MINOR della race (`client.ts:62`). |
| C3 | OK | Challenge e token salvati; logout nativo rimuove il token anche se `logout()` rifiuta. Restano i MINOR su `clearToken` senza catch e `keepNativeSession`. |
| C4 | OK | `restNotifications.ts`: id fisso, offset da `clockOffsetMs`, titolo con e senza nome, sostituzione e cancellazioni. 14 test più `NativeBridge`. Resta il MINOR dell'ordine del cancel al logout. |
| C5 | OK | Richiesta permesso, nessun fetch verso push, messaggio di permesso negato, niente "Installa YFP". |
| C6 | OK | `hapticRestEnd` nel ramo di beep e vibrate (regola dei 5 s); `hapticSetComplete` solo al complete; nessuna chiamata sul web. |
| C7 | OK | Verificato eseguendo le build: PWA con `sw.js` e `registerSW.js`; nativa senza, con URL assoluto; errore esplicito senza la variabile. |
| C8 | OK (riportato) | `test_auth_bearer.py` verde sul server. |
| C9 | OK (riportato) | `test_auth_native.py` verde sul server. |
| C10 | OK (riportato) | Logout, `DELETE sessions`, `current: true` con Bearer verdi sul server. |
| C11 | OK (riportato) | `test_cors.py` verde; preflight curl sul dominio reale: 200 con ACAO per `capacitor://localhost`, nessun ACAO per `evil.example`. |
| C12 | OK (riportato) | Tag `v0.0.1` pushato solo su Gitea, arrivato via mirror, run 38302333605 partito. |
| C13 | OK (riportato) | Secondo tentativo verde, con controllo versione e release GitHub e Gitea. Asset Gitea confermato dall'utente, non verificabile da qui. |
| C14 | OK (riportato) | Utente: "funziona tutto"; manca il dettaglio. |
| C15 | OK (riportato) | Come sopra, senza esito punto per punto. |
| C16 | OK (riportato) | Notifiche funzionanti; il suono usato non è annotato. |
| C17 | OK (riportato) | Generico; non annotato se Salta, fine, annullamento e +15 s siano stati provati singolarmente. |
| C18 | OK (riportato) | Haptics funzionanti. |
| C19 | OK (riportato) | Modalità aereo: "Impossibile contattare il server", come da spec. L'offline vero è rimandato. |
| C20 | OK | File web da preservare invariati e verdi; body di login web senza token né challenge. |
| C21 | OK (riportato) | `push.ts`, `RestAlertSetting`, `push-sw.js` invariati; pytest push verdi sul server. |
| C22 | OK | `RestTimerBar` con una riga aggiunta; test esistenti invariati e verdi. |
| C23 | OK (riportato) | Configurazione VitePWA identica fuori dal mode nativo; OAuth/MCP verdi sul server; preflight `/token` sul dominio reale invariata. |
| C24 | OK (riportato) | Cambio password da cookie revoca le sessioni Bearer e mantiene la corrente. |
| C25 | OK | `cd web && npm test`: 74 file, 485 test passati. |
| C26 | OK (riportato) | 24 fallimenti identici al baseline `origin/main` (DB condiviso e ambiente del server). Non vale "tutti passano" in senso letterale. |

## Test

`cd web && npm test`: 74 file di test, 485 test passati, 0 falliti.
`cd web && npm run build`: ok. `VITE_API_BASE_URL=... npm run build:native`: ok. Senza la variabile: errore esplicito.
pytest (server, DB isolato `yfp_test`): non rieseguito dal reviewer. Suite intera con 24 fallimenti identici a `origin/main`, nessuno solo sulla feature.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- Nessuno

### MINOR
Meritano un piccolo task di correzione:
- `web/src/auth/AuthContext.tsx:45` — Al logout nativo la notifica è cancellata prima di `logout()` e di `clearClientCaches`; un refetch di `gymKeys.active` in quella finestra la riprogramma e dopo `queryClient.clear()` nessuno la cancella (suona dopo il logout). Richiamare `cancelRestNotification().catch(() => undefined)` dopo `clearClientCaches`.
- `web/src/auth/AuthContext.tsx:52` — `await clearToken()` senza catch: se `Preferences.remove` rifiuta, `useLogout` lancia e non naviga. Usare `await clearToken().catch(() => undefined)`.
- `web/src/api/client.ts:62` — Un 401 `unauthorized` tardivo cancella il token appena salvato dal login. Chiamare `clearToken()` solo se `getToken() === token`.
- avviso nuovo: `.github/workflows/ios-release.yml:41` — `actions/checkout@v4` senza `ref`: con `workflow_dispatch` si costruisce il branch scelto e non il tag, e `action-gh-release` crea il tag mancante su GitHub, una scrittura diretta che confligge col mirror. Aggiungere `with: ref: ${{ env.TAG }}`, oppure far scegliere il tag in "Use workflow from" nel README.

Accettabili senza task:
- `web/src/api/auth.ts:13-15` — Se `Preferences.set` fallisce, `verifyTotp`/`setupComplete` rifiutano a sessione server già creata. Improbabile.
- `web/src/components/NativeRestAlertSetting.tsx:52-53`, `:61-64` — Stato incoerente se `syncRestNotification` o `cancelRestNotification` falliscono; mancano i test dei percorsi di errore.
- `web/src/native/NativeBridge.tsx:34` — `extra.url` non validato; le notifiche le crea solo l'app. Restringere a `/gym/workout` è facoltativo.
- `api/app/auth/sessions.py:104` — `X-YFP-Challenge` accettato anche senza `X-YFP-Client`; innocuo (valore firmato, stessa `max_age`).
- `web/ios/App/CapApp-SPM/Package.swift:15-18` — Path con backslash scritti da `cap sync` su Windows; la CI li rigenera (confermato dal run 38302333605).
- `web/src/components/gym/RestTimerBar.native.test.tsx:45-60` — Non verifica beep e vibrate insieme all'haptic.

### Avvisi nuovi
- avviso nuovo: lacuna di evidenza su C14–C18. Il registro riporta solo "funziona tutto"; mancano l'esito punto per punto e il suono usato dalla notifica (campanella da `Library/Sounds` o suono di sistema).
- avviso nuovo: C26 non è "tutti i test passano" in senso letterale (24 fallimenti preesistenti, identici al baseline).

## Note

La feature è completa e non rompe nulla di dichiarato. Debito lasciato:
- I 4 MINOR da correggere vanno nella prossima feature (la prima voce tocca il flusso di logout, la seconda il token, la quarta la procedura di rilascio manuale).
- Offline: la sessione si apre dal bundle ma `AuthGuard` chiama `/auth/me` e mostra l'errore. L'apertura offline con dati in cache è il primo obiettivo della prossima feature.
- Icona app: resta il placeholder Capacitor. Da includere nella prossima feature.
- Isolamento dei test pytest: i 24 fallimenti del DB condiviso restano un follow-up già noto.
