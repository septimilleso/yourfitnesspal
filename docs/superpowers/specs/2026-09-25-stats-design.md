# Statistiche, rotella impostazioni e giorni di fila

## Problema

Le impostazioni occupano un tab della barra in basso e contengono gli obiettivi giornalieri. Serve una sezione Statistiche, per dieta e palestra, e un contatore dei giorni consecutivi di accesso all'app. Le impostazioni diventano una rotella in alto a destra. Le statistiche palestra sono fuori da questo spec: la pagina palestra è un segnaposto.

## Decisioni

- Il tab Impostazioni esce dalla barra in basso. Al suo posto c'è il tab **Statistiche** in entrambe le sezioni:
  - dieta: Giorno / Cerca / Settimana / Statistiche (`/stats`), icona `chart` della dieta;
  - palestra: Storico / Inizia / Esercizi / Statistiche (`/gym/stats`), icona `chart` della palestra.
- Le impostazioni si aprono da una rotella (icona `gear` della sezione corrente) in alto a destra nell'header delle pagine dentro `AppShell`. La rotella porta a `/settings`, che resta pagina condivisa.
- `/settings` contiene: Account (con le connessioni MCP, come oggi) e Gestione utenti (solo admin). Il form obiettivi esce da qui.
- Il form obiettivi (kcal + percentuali macro, spec `2026-09-25-macro-goals-percent-design.md`) si sposta invariato in cima a Statistiche dieta. Il codice va estratto in un componente `GoalForm`, con gli stessi comportamenti, permessi (`goals.edit`) e messaggi.
- "Giorno attivo" = l'utente apre l'app web autenticato quel giorno. Le chiamate MCP non contano. Il giorno è calcolato con `settings.app_timezone` (`Europe/Rome`).
- Periodi dei grafici: 7 / 30 / 90 giorni (finiscono oggi, oggi incluso) oppure intervallo personalizzato da–a, al massimo 366 giorni.
- Grafici SVG fatti a mano, senza nuove dipendenze.
- Statistiche dieta usa come sfondo l'illustrazione del gatto chef (`web/art/dieta/stats.png`). Il gatto deve restare ben visibile.

## Backend

### Giorni attivi

- Nuova tabella `user_activity_days`: `user_id` (FK `users.id`, `ON DELETE CASCADE`), `day` (`date`). PK composta `(user_id, day)`. Migrazione alembic nuova.
- `POST /api/activity` (utente autenticato con sessione): inserisce il giorno corrente con `INSERT ... ON CONFLICT DO NOTHING`. Risposta `204`. Idempotente.
- `GET /api/stats/streak` restituisce `{ "current": int, "best": int }`:
  - `current`: giorni consecutivi terminati oggi. Se oggi non è registrato, la serie termina ieri. Se anche ieri manca, `0`.
  - `best`: serie consecutiva più lunga di sempre, mai minore di `current`.
  - Calcolo in un servizio puro su una lista ordinata di date, testabile senza DB.

### Totali per intervallo

- `GET /api/diary/range?start=YYYY-MM-DD&end=YYYY-MM-DD` restituisce `{ start, end, days: [{ date, total }] }`, con un elemento per ogni giorno dell'intervallo, inclusi i giorni vuoti (totali a zero). Stesso formato di `WeekDayTotal`.
- `get_week` riusa la stessa funzione con `end = start + 6`.
- Validazione: `start > end` o intervallo oltre 366 giorni restituiscono `400` (eccezione `Invalid`, come il resto della API diario).

## Frontend

### Navigazione

- `AppShell`: `SETTINGS_TAB` rimosso; ultimo tab Statistiche per sezione.
- Header: un componente `SettingsButton` (link con `aria-label="Impostazioni"`, icona `gear` 28px, area toccabile 44px) posizionato in alto a destra, nella riga di `ModeSwitch`. Visibile anche per chi non ha il permesso palestra (in quel caso `ModeSwitch` non si vede, ma la rotella sì). Non si mostra sulla pagina `/settings` stessa.
- `appMode`: `/stats` appartiene alla dieta, `/gym/stats` alla palestra.
- Registrazione accesso: `AppShell` chiama `POST /api/activity` al montaggio e a ogni `visibilitychange` verso `visible`. Errori ignorati silenziosamente. Dopo il successo invalida la query `["streak"]`.

### Card giorni di fila

- Componente `StreakCard` in cima a entrambe le pagine statistiche: "N giorni di fila" in evidenza, "Record: M" in secondario. Con `current = 0` mostra "Inizia oggi la tua serie" (caso raro: la chiamata di oggi non è ancora arrivata).

### Statistiche dieta (`/stats`)

Ordine dall'alto:

1. `StreakCard`.
2. Card Obiettivi: `GoalForm`.
3. Selettore periodo: controllo segmentato 7g / 30g / 90g / Personalizzato. Personalizzato mostra due `input type="date"` (da, a). Intervallo non valido (da > a, oltre 366 giorni, date future oltre oggi): messaggio di errore e nessuna richiesta. Periodo scelto nel query string (`?range=30` oppure `?from=...&to=...`), default 7.
4. **Calorie al giorno**: barre verticali, linea tratteggiata sull'obiettivo kcal (se esiste). Barre sopra obiettivo in rosso, sotto in verde, come la settimana.
5. **Macro al giorno**: barre impilate proteine / carboidrati / grassi in grammi, colori macro esistenti (`#3b82f6`, `#f59e0b`, `#a855f7`), legenda.
   - Periodi oltre 31 giorni: una barra per settimana (lunedì–domenica, media dei giorni registrati della settimana) in entrambi i grafici. Etichette asse x: giorno/mese.
6. **Ripartizione macro**: due barre orizzontali 100%, "Consumato" (media del periodo, percentuali calcolate sulle kcal dei macro: 4/4/9) e "Obiettivo" (percentuali da `normalizeMacroPercentages`). Senza obiettivo, solo la barra Consumato.
7. **Medie del periodo**: tabella con kcal medie, grammi medi di proteine, carboidrati e grassi, giorni registrati su giorni totali, giorni sopra obiettivo kcal.

Regole di calcolo (funzioni pure in `web/src/lib/stats.ts`):

- Giorno registrato = giorno con `total.kcal > 0`.
- Medie sui soli giorni registrati. Nessun giorno registrato: grafici vuoti con messaggio "Nessun dato nel periodo" e tabella a trattini.
- Arrotondamento: kcal e grammi all'intero.

Sfondo e visibilità del gatto:

- L'immagine è generata da `build-art.py` in `web/public/art/diet/stats.webp` (stessa pipeline di `scene`) ed esposta da `art.ts` come `statsScene()`.
- In `/stats` lo sfondo pattern di `AppShell` è sostituito dall'immagine, fissa (`fixed inset-0`, `bg-cover`, `bg-bottom`), così il gatto resta ancorato in basso durante lo scroll.
- Le card della pagina hanno sfondo semitrasparente con blur (`bg-white/85 backdrop-blur-sm`, come la pagina di login).
- In fondo alla pagina uno spazio vuoto alto `55vh`: a fine scroll nessuna card copre il gatto, che appare intero sopra la barra in basso.

### Statistiche palestra (`/gym/stats`)

- `StreakCard` e sotto una card "Statistiche palestra in arrivo". Sfondo pattern normale. Protetta da `workouts.use` come le altre pagine palestra.

## Errori e casi limite

- Nessun obiettivo: grafici senza linea obiettivo, ripartizione con sola barra Consumato, "giorni sopra obiettivo" a trattino.
- Errore di caricamento range o streak: messaggio di errore nella card relativa, il resto della pagina funziona.
- `POST /api/activity` fallito: nessun messaggio; al prossimo rientro nell'app riprova.
- Cambio di giorno con app aperta: il `visibilitychange` successivo registra il nuovo giorno.

## Test

pytest (su deploy remoto, vedi memoria):

1. `POST /api/activity` crea una riga, seconda chiamata stesso giorno non duplica, `401` senza sessione.
2. Calcolo streak: lista vuota, solo oggi, serie terminata ieri, buco di un giorno, `best` su serie passata più lunga.
3. `GET /api/stats/streak` usa il fuso `app_timezone`.
4. `GET /api/diary/range`: giorni vuoti inclusi, totali corretti, `400` su `start > end` e oltre 366 giorni, isolamento tra utenti.
5. `get_week` invariato (test esistenti verdi).

vitest:

1. `AppShell`: tab Statistiche in dieta e palestra, nessun tab Impostazioni, `POST /api/activity` chiamato al montaggio.
2. `SettingsButton` porta a `/settings`, assente su `/settings`.
3. `SettingsPage` senza form obiettivi, con Account e link admin.
4. `GoalForm`: i test attuali del form obiettivi spostati da `SettingsPage.test.tsx`.
5. `lib/stats.ts`: medie sui soli giorni registrati, aggregazione settimanale oltre 31 giorni, ripartizione percentuale, giorni sopra obiettivo.
6. `DietStatsPage`: cambio periodo aggiorna la richiesta, intervallo personalizzato non valido blocca la richiesta, stato senza dati, stato senza obiettivo.
7. `StreakCard`: valori e caso `current = 0`.
