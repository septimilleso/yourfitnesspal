# Obiettivi macro in percentuale

## Problema

`SettingsPage` permette di impostare calorie e macronutrienti direttamente in grammi. Serve impostare carboidrati, proteine e grassi in percentuale delle calorie giornaliere, mostrando sotto ogni percentuale i grammi calcolati, non modificabili. L’interfaccia deve mantenere lo stile attuale.

## Decisioni

- Calorie restano un campo modificabile in kcal.
- Carboidrati, proteine e grassi diventano percentuali intere modificabili, ciascuna tra 0% e 100%.
- La somma delle tre percentuali deve essere esattamente 100% per salvare.
- I grammi risultanti sono mostrati sotto il nome del macronutriente, con stile secondario, e non sono modificabili.
- Calcolo grammi: `round(kcal * percentuale / 4)` per carboidrati e proteine; `round(kcal * percentuale / 9)` per grassi. L’arrotondamento è al grammo più vicino.
- Per obiettivi esistenti, ricavo le percentuali dalle calorie dei macro (`4 × proteine`, `4 × carboidrati`, `9 × grassi`), divise per il totale calorico dei macro. Distribuisco i resti dell’arrotondamento con il metodo dei maggiori resti; in caso di parità, uso l’ordine carboidrati, proteine, grassi. La somma iniziale è 100% e le proporzioni sono preservate nel modo più accurato possibile. I grammi mostrati possono differire da quelli salvati in precedenza, perché ora derivano dalla distribuzione normalizzata sul target kcal.
- Se un obiettivo esistente ha tutti i macro a zero, non esiste proporzione da preservare: lascio le percentuali vuote e richiedo all’utente di impostarle.
- La API e il database non cambiano. `PUT /api/goals` riceve gli stessi campi in grammi; il client converte percentuali in grammi al salvataggio.
- Mantengo struttura a card, separatori, spaziature, colori macro, stati di caricamento e messaggi di esito già presenti.

## Interfaccia

Mantengo la riga calorie attuale. Ogni riga macro mantiene nome e colore a sinistra e campo percentuale a destra. Sotto il nome mostro il valore calcolato in grammi, in testo secondario non interattivo. Le percentuali sono l’unico input macro.

Quando la somma non è 100%, mostro un messaggio di validazione vicino ai campi e impedisco il salvataggio. La UI aggiorna percentuali, somma e grammi in tempo reale. Utenti senza permesso `goals.edit` continuano a vedere i campi disabilitati.

## Architettura e flusso dati

La modifica resta in `web/src/pages/SettingsPage.tsx` e nei relativi test. Lo stato del form conserva calorie e percentuali. Una funzione pura converte obiettivi esistenti in percentuali intere e calcola i grammi previsti; i dati inviati alla mutation mantengono il tipo `Goal` già previsto da `web/src/api/queries.ts`.

Non servono nuove dipendenze, endpoint, migrazioni o modifiche ai riepiloghi giornalieri: questi continuano a leggere obiettivi in grammi.

## Errori e casi limite

- Input percentuale vuoto o fuori dall’intervallo 0–100 impedisce il salvataggio.
- Somma diversa da 100 impedisce il salvataggio e rende visibile il totale corrente.
- Percentuali sono numeri interi; il totale viene calcolato sui valori inseriti.
- Calorie vuote continuano a essere bloccate dalla validazione HTML esistente.
- Dati esistenti con macro a zero inizializzano percentuali vuote, senza divisione per zero.

## Test

Aggiornare `web/src/pages/SettingsPage.test.tsx` per verificare:

1. Visualizzazione di calorie, percentuali e grammi calcolati.
2. Conversione di un obiettivo esistente in percentuali che sommano a 100% e ne preservano le proporzioni.
3. Calcolo dei grammi per carboidrati, proteine e grassi, inclusi arrotondamenti.
4. Blocco del salvataggio quando la somma percentuale non è 100%.
5. Invio alla mutation del payload esistente in grammi, senza campi percentuali.
6. Gestione di un obiettivo esistente con tutti i macro a zero.
7. Permessi, stato senza obiettivo, caricamento, successo ed errore restano coerenti.
