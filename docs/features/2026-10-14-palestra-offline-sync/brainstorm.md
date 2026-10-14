# Brainstorm: Palestra offline con sync a blocco

- Data: 2026-10-14
- Stato: completato

## Problema

Nell'IPA (v0.0.3) l'offline è solo in lettura: il precarico e la persistenza delle query mostrano modelli, storico e statistiche, ma ogni azione dell'allenamento (avvio, segna serie, riposo, aggiungi esercizio, fine) chiama il server e fallisce senza rete. In palestra il segnale è scarso, quindi proprio lì l'app non è utilizzabile. L'utente l'ha verificato sull'iPhone il 2026-10-14: "non posso compiere azioni come segnare gli esercizi". Lo stesso vale per il diario cibo (aggiungere o togliere un alimento, cibi in cache), che qui è trattato come feature successiva.

## Obiettivo

Con l'IPA un allenamento completo, dall'avvio alla chiusura, si svolge senza rete: l'allenamento vive in uno stato locale, mostra Precedente e Max e si sincronizza da solo con il server quando torna la rete. Misura: in modalità aereo si avvia un modello, si segnano tutte le serie, si finisce l'allenamento, e dopo il ritorno della rete lo stesso allenamento compare nello Storico del server con gli stessi dati.

## Vincoli

- Solo IPA (Capacitor, `isNative`). La PWA e il web restano come oggi, server-autoritativi, senza cambi di comportamento.
- Il server resta autoritativo per Precedente, Max e `template_diff`: non si ricalcolano nel client dallo storico.
- Le regole da replicare nel client sono quelle di `api/app/services/gym_rules.py` (`set_problem`, `rest_after_completion`, `template_diff`) più renumber delle serie, avvio/azzeramento del riposo e regole di `finish_workout` (`empty_workout`, `incomplete_sets`, serie e esercizi vuoti scartati). Servono test di parità su fixture condivise client/server.
- Utente singolo. Un allenamento attivo appartiene a un solo dispositivo alla volta (ADR 0004), con la gestione dei conflitti scelta sotto.
- Lo stato locale deve sopravvivere a chiusura dell'app e riavvio. La cache esistente usa già `@capacitor/filesystem` (`Directory.Library`, vedi `web/src/native/queryPersistence.ts`), non IndexedDB.
- Il fine riposo usa già notifiche locali (`web/src/native/restNotifications.ts`): il timer di riposo deve funzionare con lo stato locale.
- Un allenamento già in corso sul server (avviato da web) deve essere adottato nello stato locale all'apertura online.

## Fuori scope

- Diario cibo offline (aggiungere/togliere/modificare alimenti, copia giorno) e cache di `foods/search`, `foods/recent`, `foods/barcode`: seconda feature in sequenza, brainstorm a parte. Note raccolte per quella: il diario ha tre scritture semplici (`POST/PATCH/DELETE /diary/entries`), `/foods/search` passa da Open Food Facts e oggi le chiavi `foods*` non sono persistite.
- Salva come modello e applica al modello (`save-as-template`, `apply-to-template`), modifica dei modelli, eliminazione di un allenamento dallo Storico: restano online.
- Statistiche palestra e dieta aggiornate offline: mostrano l'ultima cache finché il sync non finisce.
- Uso simultaneo da due dispositivi sullo stesso allenamento.
- Cambio delle regole di Precedente/Max e di `template_diff` lato server.
- HealthKit e Live Activity.

## Alternative considerate

### Divisione della consegna
- **Due feature in sequenza (scelta).** Prima la palestra con sync a blocco, poi diario e cibi. Forme diverse (stato locale complesso contro outbox semplice), rischio diverso, e la palestra sblocca l'uso in sala. Costo totale L + M.
- Una feature sola: un'unica infrastruttura di coda e indicatore, ma piano molto lungo. Scartata.
- Prima diario e cibi: più rapido, ma rimanda il caso che pesa di più. Scartata.

### A. Local-first con `PUT /workouts/{uuid}` a blocco (scelta, ADR 0004)
Il reducer client gira sempre su stato locale, anche online. Il sync è in background: invia l'allenamento intero a `PUT /workouts/{uuid}`, idempotente e con numero di versione. — Pro: reattivo anche con rete lenta, un solo percorso di codice per l'IPA, nessun id server da conoscere offline. — Contro: regole duplicate in TypeScript, nuovo endpoint e colonna di versione. — Costo: L.

### B. Coda di mutazioni
Offline si accodano le chiamate esistenti e si rigiocano in ordine. — Pro: server quasi invariato. — Contro: `set_id` e `item_id` sono id del server, ignoti offline, quindi id temporanei ovunque e mappatura fragile (già scartata in ADR 0004). — Costo: L.

### C. Locale fino a fine allenamento
Il server riceve l'allenamento solo alla fine con un import atomico. — Pro: niente versioni né 409, endpoint minimo. — Contro: l'allenamento attivo non è sul server (web e MCP non lo vedono), si perde se si cancellano i dati dell'app. — Costo: M.

### Precedente e Max offline
- **Snapshot dal server (scelta).** Un nuovo endpoint restituisce previous e max per gli esercizi dei modelli e per quelli eseguiti di recente. Il precarico li scarica e li mette in cache. Esatto, nessuna regola di `previous_sets`/`best_sets` duplicata. Un esercizio aggiunto offline fuori dallo snapshot non ha Precedente.
- Calcolo nel client dallo storico in cache: duplica regole e può divergere. Scartata.
- Non mostrarli offline: perde la funzione principale in sala. Scartata.

### Conflitti
- **Versione più scelta dell'utente (scelta, ADR 0004).** Su versione divergente il server risponde 409 e l'utente sceglie tra copia locale e copia del server.
- Vince l'IPA finché l'allenamento è attivo: meno UI, ma sovrascrive in silenzio. Scartata dall'utente.
- Blocco di un dispositivo alla volta: web bloccato se l'IPA resta offline. Scartata.

## Scelta

A, con snapshot server per Precedente e Max e conflitti con versione e scelta dell'utente. In v1 funzionano offline: avvio da modello e allenamento libero, segnare o modificare serie e riposo (complete/uncomplete, peso, ripetizioni, durata, aggiungi/elimina serie, timer), aggiungere e togliere esercizi, superset e layout dal catalogo in cache, rinomina e fine allenamento. Un allenamento finito ma non ancora sincronizzato compare in cima a Storico con l'etichetta "da sincronizzare" e il suo dettaglio si apre dal locale; l'indicatore globale (badge in Palestra e puntino offline) mostra quanti allenamenti attendono il sync.

Dettagli di direzione, da fissare nella spec:
- **Id.** Esercizi e serie dell'allenamento locale hanno UUID generati dal client; il server li mappa a id propri al `PUT` e restituisce la mappa nella risposta.
- **Archiviazione.** File JSON in `Directory.Library` via `@capacitor/filesystem`, con scrittura atomica, come la cache delle query. Non IndexedDB.
- **Avvio del sync.** Subito dopo ogni modifica se c'è rete (con coalescing), al ritorno della rete, al ritorno in primo piano e all'apertura dell'app.
- **Allenamento attivo sul server.** All'apertura online l'app adotta l'allenamento attivo del server nello stato locale (con la sua versione). Se il server ne ha uno attivo diverso da quello avviato offline, il `PUT` risponde 409 e parte la scelta dell'utente.
- **Fine offline.** Il `PUT` con stato `finished` chiude l'allenamento sul server; al successo si invalidano storico e statistiche.

## Rischi e punti aperti

- Divergenza tra le regole client e server: test di parità sulle stesse fixture, il server resta autoritativo al `PUT` (ricalcola e restituisce l'allenamento canonico).
- Perdita dello stato locale (app disinstallata, SideStore che reinstalla): l'allenamento attivo non ancora sincronizzato andrebbe perso. Mitigazione: sync appena c'è rete; da verificare se SideStore preserva `Directory.Library` negli aggiornamenti.
- Riavvio durante un riposo: il timer e le notifiche locali devono ricostruirsi dallo stato salvato.
- Orologio del telefono: `started_at`, `completed_at` e `rest_ends_at` vengono dal client, quindi dipendono dall'ora del telefono. Il server li accetta ma ne limita la plausibilità (da decidere nella spec).
- UI di scelta in caso di 409: va progettata semplice (confronto con riepilogo di serie e orari).
- Compatibilità: versioni vecchie dell'IPA o della PWA continuano a usare gli endpoint esistenti; il nuovo `PUT` e lo snapshot sono additivi.
- Interazione con il precarico: lo snapshot di Precedente e Max entra nel giro di precarico esistente (`web/src/native/prefetch.ts`) e nella pulizia della cache.
- Collegamento con i bug aperti: la verifica T4 su iPhone del fix `errore-modelli-offline` va fatta prima di basare su questo lavoro la schermata Palestra.

## Decisioni registrate

- [0004 Palestra offline con stato locale e sync a blocco](../../decisions/0004-palestra-offline-sync-a-blocco.md), confermata dopo il confronto con le alternative di questa sessione. Aggiornata con lo storage su file nativo e lo snapshot di Precedente e Max.
