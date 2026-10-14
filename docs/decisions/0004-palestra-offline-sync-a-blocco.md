# 0004. Palestra offline con stato locale e sync a blocco

- Data: 2026-10-12
- Stato: accettata
- Feature: [2026-10-12-app-ios-offline](../features/2026-10-12-app-ios-offline/)

## Contesto

Ogni azione dell'allenamento chiama il server, che ricalcola previous/max/rest e restituisce l'intero `WorkoutOut`. In palestra il segnale è scarso. Serve un allenamento completo senza rete, che si sincronizzi al ritorno online.

## Decisione

L'allenamento attivo vive in uno stato locale (IndexedDB) modificato da un reducer client che replica le regole di `api/app/services/workouts.py`. I dati di supporto (catalogo, template, precedente/max, storico recente) sono scaricati in cache all'apertura. Il sync invia l'allenamento intero a `PUT /workouts/{uuid}`, idempotente e con numero di versione; con rete parte subito in background, senza rete resta in coda. Su versione divergente il server risponde 409 e l'utente sceglie tra copia locale e server. Il server resta autoritativo.

## Alternative scartate

- Coda di mutazioni fine-grained riprodotte in ordine: molte chiamate, id temporanei ovunque, fragile.
- Database locale con sync bidirezionale completa: sovradimensionato per un'app personale.

## Aggiornamento 2026-10-14

Dopo il brainstorm di [palestra-offline-sync](../features/2026-10-14-palestra-offline-sync/):
- Lo stato locale è un file JSON in `Directory.Library` (`@capacitor/filesystem`), come la cache delle query, e non IndexedDB.
- Precedente e Max offline vengono da uno snapshot calcolato dal server (nuovo endpoint, precaricato), non da regole duplicate nel client.
- Il resto della decisione resta valido, compresi versione e 409 con scelta dell'utente.

## Conseguenze

- Nuovo endpoint e colonna di versione sul workout.
- Regole duplicate client/server: servono test di parità su fixture condivise.
- Un allenamento attivo appartiene a un solo dispositivo alla volta.
- Statistiche palestra mostrano l'ultima cache finché il sync non completa.
