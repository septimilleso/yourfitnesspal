# 0001. Web Push con scheduler nel processo API per gli avvisi di fine riposo

- Data: 2026-09-30
- Stato: accettata
- Feature: [2026-09-30-campanella-fine-riposo](../features/2026-09-30-campanella-fine-riposo/)

## Contesto

L'utente vuole un avviso a fine riposo anche quando la PWA su iPhone è in background o lo schermo è bloccato. iOS sospende il JS della PWA in background, quindi nessun timer lato client può scattare. Il server salva già `rest_ends_at` assoluto per ogni allenamento.

## Decisione

Usiamo Web Push (VAPID) inviato dall'API. Un loop asyncio nel processo API controlla circa ogni secondo i riposi scaduti e non ancora notificati. Fa il claim di ognuno con un update atomico sul DB, poi invia il push alle subscription dell'utente. Il service worker mostra sempre una notifica per ogni push.

## Alternative scartate

- App nativa o wrapper con Live Activities: richiede Swift, account Apple Developer e distribuzione App Store/TestFlight. Troppo per un'app personale self-hosted.
- Tenere viva la pagina con audio in loop: su iOS interrompe la musica dell'utente e non è affidabile in background.
- Job queue esterna (Celery, APScheduler con store separato): dipendenza o servizio in più per un solo job con granularità di 1 secondo.
- Push ritardato programmato dal client: la Push API non prevede scheduling e iOS non supporta Notification Triggers.

## Conseguenze

- L'API ha nuove dipendenze (`pywebpush` o equivalente), chiavi VAPID in env e una tabella di subscription. La stessa infrastruttura è riusabile per altre notifiche.
- Il loop gira dentro il processo uvicorn. Con più worker o repliche il claim atomico evita duplicati, ma ogni processo esegue il proprio loop.
- Un tick perso (riavvio del processo) ritarda l'avviso al massimo di un'iterazione dopo l'avvio; il claim garantisce l'invio al più una volta.
- Il service worker generato da vite-plugin-pwa deve ricevere un handler `push` custom.
