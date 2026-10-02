# 0002. Statistiche calcolate lato server e condivise tra web e MCP

- Data: 2026-10-02
- Stato: accettata
- Feature: [2026-10-02-statistiche-palestra-peso](../features/2026-10-02-statistiche-palestra-peso/)

## Contesto

La feature aggiunge statistiche palestra (progressione per esercizio, 1RM stimato, record personali, riepilogo del periodo, frequenza settimanale) e il tracciamento del peso con media mobile a 7 giorni e medie settimanali. Gli stessi numeri servono in due posti: nella web app e nei tool MCP (`get_weight_history`, `get_exercise_progress`, `get_gym_stats`) che Claude usa per analizzare i dati. Le statistiche della Dieta oggi sono calcolate nel web (`web/src/lib/stats.ts`) a partire dai giorni del diario.

## Decisione

Calcoliamo le statistiche palestra e peso nell'API, in servizi dedicati (`app/services/`) con aggregazioni SQL. Gli endpoint REST e i tool MCP chiamano gli stessi servizi. Il web riceve valori già aggregati e si occupa solo di mostrarli.

## Alternative scartate

- Calcolo nel web e ricalcolo separato in Python per MCP: logica duplicata in due linguaggi, rischio che app e Claude mostrino numeri diversi, e il web dovrebbe scaricare tutto lo storico paginato.
- Tabelle di riepilogo precalcolate a fine allenamento: eccessive per pochi utenti, richiedono un backfill e la gestione di cancellazioni e modifiche.

## Conseguenze

- Ogni metrica ha una sola definizione (media mobile, 1RM, PR), testata una volta in pytest.
- I test di queste metriche sono test DB, quindi girano solo sul deploy remoto. I test web coprono il rendering con dati finti.
- Le statistiche Dieta restano calcolate nel web: l'incoerenza è accettata finché nessun tool MCP ne ha bisogno.
- Se le query su tutto lo storico diventassero lente, si aggiungono indici prima di introdurre cache.
