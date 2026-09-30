# Brainstorm: Campanella a fine riposo

- Data: 2026-09-30
- Stato: concluso

## Problema

Durante l'allenamento l'utente usa gli auricolari con la musica, con la PWA installata sulla Home dell'iPhone. Quando scade il timer di riposo non sente nulla. L'app chiama già `beep()` (due toni WebAudio a 880 Hz) e `vibrate()` in `RestTimerBar`, ma:

- anche con app in primo piano e schermo acceso, il bip non si sente negli auricolari;
- durante il riposo l'utente sia blocca il telefono sia passa ad altre app (Spotify, chat): iOS sospende la PWA e nessun JS gira;
- in palestra è attivo un Focus che silenzia le notifiche. L'app nativa Strong invece suona, e l'utente si aspetta lo stesso.

`navigator.vibrate` non esiste su iOS, quindi oggi la vibrazione non fa nulla.

## Obiettivo

A fine riposo l'utente sente un avviso negli auricolari sia con YFP in primo piano, sia in background, sia a schermo bloccato. In primo piano l'avviso è una campanella vera che suona sopra la musica; in background è una notifica iOS con il suono di sistema.

## Vincoli

- iPhone, iOS 26, PWA installata sulla Home. Web Push funziona solo per PWA installate (iOS 16.4+).
- La campanella può suonare solo in primo piano. La notifica in background usa il suono di sistema: le notifiche web non permettono un suono custom.
- Il Focus blocca le notifiche di YFP, a meno che l'utente non aggiunga YFP alle app consentite. È un passo manuale dell'utente: l'app può solo spiegarlo.
- Il web push non può usare il livello "time-sensitive" che le app native usano per superare il Focus.
- iOS chiede il permesso notifiche solo dopo un tap dell'utente.
- iOS revoca la subscription se arriva un push e il service worker non mostra una notifica. Quindi ogni push deve mostrare una notifica, anche con app in primo piano.
- L'API gira come un solo processo uvicorn (`api/Dockerfile`), quindi un loop in background dentro il processo non manda duplicati. Un claim con update atomico sul DB resta sicuro anche se in futuro si aggiungono worker.
- Il server salva già `rest_ends_at` assoluto. Cambia con start, +15s/-15s e salta.
- Non esiste infrastruttura push: niente chiavi VAPID, tabella subscription, scheduler, né handler push nel service worker (vite-plugin-pwa `generateSW`).

## Fuori scope

- Dynamic Island / Live Activities: richiedono un'app nativa (ActivityKit, estensione widget Swift, account Apple Developer). Una PWA non può usarle.
- Suono custom per la notifica in background.
- Wrapper nativo (Capacitor o simili).
- Ottimizzazioni specifiche per Android (pattern di vibrazione ecc.): funziona se il browser lo supporta, ma non lo testiamo.
- Notifiche push per eventi diversi dalla fine del riposo.
- Prompt o banner di permesso nella pagina allenamento: l'unico punto di attivazione è il toggle in Impostazioni.

## Alternative considerate

### A. Push dal server + campanella in-app
L'API invia un Web Push quando scade `rest_ends_at`. In primo piano la pagina suona anche un campione di campanella che si mixa con la musica. — Pro: copre background e schermo bloccato; sistema il bip muto di oggi; fallback in-app se il push fallisce. — Contro: in primo piano doppio avviso (notifica + campanella); serve infrastruttura push (VAPID, tabella subscription, loop scheduler, handler nel service worker). — Costo: M-L

### B. Solo push
Come A, senza audio in-app. — Pro: un solo meccanismo, meno codice. — Contro: in primo piano dipende dall'arrivo della notifica e dal permesso; nessun fallback. — Costo: M

### C. Solo primo piano
Campanella che si mixa con la musica, più Wake Lock per tenere lo schermo acceso durante l'allenamento. — Pro: piccolo, niente backend. — Contro: non copre il cambio app né lo schermo bloccato, cioè l'uso reale dell'utente. — Costo: S

## Scelta

A. Su iOS il Web Push è l'unico modo affidabile per avvisare mentre la PWA è sospesa. La campanella in-app sistema il bip muto in primo piano e fa da fallback se la notifica non arriva. L'utente accetta il suono di sistema in background e aggiungerà YFP al Focus palestra.

Schema del push (da raffinare nella spec):
- Chiavi VAPID da env; `pywebpush` (o equivalente) nell'API.
- Tabella delle subscription push per utente (endpoint, p256dh, auth), con endpoint di subscribe e unsubscribe. Le subscription che rispondono 404/410 vengono rimosse.
- Loop asyncio nel processo API, circa ogni 1 s: fa il claim dei workout con `rest_ends_at` scaduto e non ancora notificato (update atomico che registra quale `rest_ends_at` è stato notificato), poi invia il push. Aggiusta e salta cambiano `rest_ends_at`, quindi il vecchio valore non viene mai inviato.
- Service worker: handler `push` aggiunto (es. via workbox `importScripts`) che mostra sempre una notifica ("Riposo finito"), e handler `notificationclick` che apre o porta in primo piano l'allenamento.
- Toggle "Avviso fine riposo" in Impostazioni: chiede il permesso, fa la subscribe, spiega come consentire YFP nel Focus.

## Rischi e punti aperti

- Causa del bip muto in primo piano: non confermata. Ipotesi: sessione audio WebAudio silenziata da interruttore silenzioso o da altro audio, `AudioContext` sospeso o interrotto dopo lo spegnimento dello schermo, contesto mai sbloccato. Il fix deve usare `navigator.audioSession.type` (Safari 17+) con una modalità che si mixa con la musica, riprendere il contesto su `visibilitychange` e suonare un campione di campanella vero. Da verificare sul dispositivo.
- Doppio avviso in primo piano (notifica + campanella): accettato per ora. Verificare se iOS mostra il banner del web push con la PWA in primo piano; se dà fastidio, provare l'opzione `silent` o una notifica più discreta.
- Latenza del push (APNs) di solito circa 1 s; il loop a 1 s aggiunge fino a 1 s. Accettabile.
- L'avviso non deve mai scattare per un riposo saltato o modificato: coprire con un test sulla logica di claim dello scheduler.
- Il Focus blocca le notifiche se l'utente non aggiunge YFP: il testo in Impostazioni deve spiegarlo.
- I test DB girano solo sul deploy remoto (niente Postgres locale).
- Subscription vecchie o duplicate per dispositivo: deduplicare per endpoint.

## Decisioni registrate

- [ADR 0001: Web Push con scheduler nel processo API per gli avvisi di fine riposo](../../decisions/0001-web-push-scheduler-in-process.md)
