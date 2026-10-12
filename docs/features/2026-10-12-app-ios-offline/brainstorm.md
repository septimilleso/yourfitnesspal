# Brainstorm: App iOS (IPA) con palestra offline

- Data: 2026-10-12
- Stato: completato

## Problema

La PWA su iPhone ha limiti: lo storage può essere cancellato dopo giorni di inattività, in palestra il segnale è spesso scarso (ogni azione dell'allenamento chiama il server e fallisce offline), il fine riposo dipende dal Web Push e non c'è accesso a funzioni native. L'utente vuole un'app installabile (IPA) distribuita con SideStore, compilata in automatico dal push su Gitea.

## Obiettivo

Un'IPA non firmata, costruita da CI al push di un tag e installabile con SideStore, che incapsula la UI esistente. Con l'IPA l'allenamento in palestra funziona completamente offline (avvio da template in cache, serie, riposo, superset, aggiunta esercizi, fine) e si sincronizza con il server appena torna la rete, con login identico a quello online (password + TOTP).

## Vincoli

- Distribuzione con SideStore: firma con account Apple gratuito, quindi niente entitlement Push (APNs) e limite di App ID per settimana. Niente Web Push dentro la WebView.
- Fine riposo: notifiche locali (UNUserNotificationCenter) schedulate dal telefono, nessun server né APNs.
- UI inclusa nel bundle dell'IPA (necessario per l'offline). Ogni modifica UI richiede una nuova IPA. La PWA resta, con lo stesso codice.
- Server raggiungibile da dominio pubblico HTTPS. Il client nativo parla con un URL assoluto, cross-origin.
- Utente singolo, un dispositivo alla volta sullo stesso allenamento attivo.
- Pipeline già abbozzata: `.github/workflows/ios-release.yml` (macOS runner GitHub su tag `v*`, release GitHub + copia su release Gitea). Gitea `origin` è la fonte, GitHub è solo mirror. Manca il progetto `web/ios` (Capacitor non è ancora aggiunto).

## Fuori scope

- APNs / push remoti.
- HealthKit e Live Activity oltre al timer di riposo (feature successiva).
- Offline per il diario cibo oltre alla lettura da cache.
- Modifica dei template e "salva come template" offline.
- Uso simultaneo da due dispositivi sullo stesso allenamento.
- Firma/notarizzazione per App Store o TestFlight.

## Alternative considerate

### A. Capacitor, UI nel bundle, Bearer token, outbox locale (scelta)
Capacitor incapsula la build Vite. Login come online ma il server restituisce anche un token per il client nativo (header `Authorization: Bearer`). Stato dell'allenamento in IndexedDB, sync a blocco con endpoint idempotente. — Pro: offline reale, indipendente da ITP, riuso del frontend. — Contro: duplicazione delle regole di `workouts.py` in TypeScript, nuova IPA a ogni cambio UI. — Costo: L (in quattro feature).

### B. Capacitor con `server.url` verso il server
La WebView carica la PWA remota. — Pro: nessun CORS, UI sempre aggiornata. — Contro: senza rete l'app non si apre, quindi niente offline. — Costo: S.

### C. App Swift/WKWebView scritta a mano
— Pro: controllo totale. — Contro: bridge notifiche/haptics da scrivere, nessun ecosistema plugin, più manutenzione per un'app personale. — Costo: L.

Auth: cookie `SameSite=None` + CORS + plugin HTTP nativo scartato perché dipende da ITP/WebView e dal comportamento interno del plugin.

## Scelta

A. Login con la stessa esperienza dell'online (password + TOTP); cambia solo il trasporto della sessione (token invece di cookie nell'IPA). Sessione persistente, così offline non serve rifare il login.

Ordine consigliato delle feature:
1. **IPA shell**: Capacitor, build CI, release su Gitea/GitHub, auth Bearer, notifiche locali di fine riposo, haptics. Valida la pipeline fino a SideStore.
2. **Live Activity del timer di riposo (Dynamic Island + schermata di blocco)**: Widget Extension Swift con `Text(timerInterval:)`, avvio/stop locale da plugin Capacitor, nessun APNs. Prima dell'offline perché è il rischio maggiore con SideStore (App ID in più per l'extension) e riusa il timer di riposo della feature 1.
3. **Palestra offline + sync**: cache all'apertura (catalogo, template, precedente/max, storico), stato locale con reducer client, endpoint `PUT /workouts/{uuid}` idempotente con versione, indicatore "da sincronizzare", sync immediato se online e coda se offline.
4. **HealthKit** (futura).

## Rischi e punti aperti

- Divergenza tra regole client e server per previous/max/superset: test di parità sulle stesse fixture, il server resta autoritativo al sync.
- Conflitti: versione per allenamento; 409 su divergenza e scelta esplicita tra copia locale e server.
- Prima apertura senza rete: serve almeno un sync iniziale.
- Live Activity: l'extension consuma un App ID in più sull'account gratuito; verificare presto che SideStore la firmi e la installi. Senza Dynamic Island (prima di iPhone 14 Pro) resta solo la schermata di blocco.
- Limite App ID SideStore e scadenza a 7 giorni: auto-refresh di SideStore; da verificare sul telefono.
- Distribuzione aggiornamenti: SideStore può usare una "source" JSON per versioni nuove; da decidere nella feature 1.
- Verificare che il mirror Gitea → GitHub inoltri i tag che fanno partire il workflow.
- Service worker/PWA nel bundle Capacitor: va disattivato o gestito per non interferire.

## Decisioni registrate

- [0003 Autenticazione Bearer per il client nativo](../../decisions/0003-auth-bearer-client-nativo.md)
- [0004 Palestra offline con stato locale e sync a blocco](../../decisions/0004-palestra-offline-sync-a-blocco.md)

## Aggiunte dopo la feature 1

- Icona app: l IPA della feature 1 usa l icona predefinita di Capacitor (AppIcon placeholder in web/ios/App/App/Assets.xcassets). La vera icona (art di YFP) va inclusa nella **prossima feature**, qualunque essa sia. Richiesta dell utente 2026-10-12.
- Offline: l utente si aspettava che l IPA si aprisse offline con i dati in cache già dalla feature 1. La spec della feature 1 lo escludeva (C19). Priorità alta per la prossima feature; ordine ancora da decidere tra offline e Live Activity.
