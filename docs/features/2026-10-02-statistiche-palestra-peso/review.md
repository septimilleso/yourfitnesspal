# Review: Statistiche palestra e peso giornaliero

- Data: 2026-10-05
- Verdetto: APPROVED
- Diff: `5690b5d..feature/statistiche-palestra-peso`
- Reviewer: devflow-reviewer (sonnet/high)

## Criteri di accettazione

"Non verificabile qui" significa che il criterio richiede Postgres, che in locale non c'è. Per questi criteri l'esito viene dai test eseguiti sul server in T17 e dalla lettura del codice.

| Criterio | Esito | Note |
|---|---|---|
| C1 | OK | `ModeSwitch.test.tsx`: pulsante peso e ingranaggio su `/` e `/gym/history`, assente su `/settings`, presente anche senza permesso palestra. |
| C2 | OK | `WeightOverlay.test.tsx` e `weights.test.tsx`: virgola, campo precompilato, errore senza chiudere, invalidazione della query del peso. |
| C3 | OK (T17) | `test_weights.py`: upsert, `app_timezone`, arrotondamento, intervallo 400, CSRF 403. |
| C4 | OK (T17) | Test puri verdi in locale (22) più `test_weights.py`. |
| C5 | OK (T17) | Eliminazione limitata all'utente, 400 per periodo non valido. |
| C6 | OK | `DietStatsPage.test.tsx` e `charts.test.tsx`. |
| C7 | OK | `WorkoutCountCard.test.tsx` e `badges.test.ts`. |
| C8 | OK | `GymStatsPage.test.tsx`. |
| C9 | OK (T17) | Volume 1140, durata media 75, settimane con zeri. |
| C10 | OK (T17) | 1RM 116,7 e 105,0, record con data, archiviati inclusi, 404 e 403. Il dataset del test non coincide esattamente con quello di C10. |
| C11 | OK | `GymStatsPage.test.tsx`. |
| C12 | OK | `HistoryPage.test.tsx`. |
| C13 | OK (T17) | `test_mcp_tools_stats.py`: stessi valori del REST, default, limite di 366 giorni, permesso. |
| C14 | OK (T17) | Tool solo in lettura; esercizio custom altrui risulta "not found". |
| C15 | OK (a vista) | T18, confermato dall'utente su iPhone. |
| C16 | OK (a vista) | T18. |
| C17 | OK | Test della serie e dei badge Dieta invariati e verdi. |
| C18 | OK (T17) | `test_activity_router` e `test_streak` verdi sul server. |
| C19 | OK | Test di Statistiche Dieta verdi. Con T19 i grafici della Dieta hanno anche l'asse Y (vedi Note). |
| C20 | OK | `ModeSwitch`, `AppShell` e `appMode` verdi. |
| C21 | OK | `HistoryPage.test.tsx` e T18. |
| C22 | OK | `WorkoutDetailPage.test.tsx` verde; il file sorgente non è modificato. |
| C23 | OK (T17) | Il servizio e il router `DELETE` dei workout non sono nel diff. |
| C24 | OK | Nessun file della sessione live toccato; test verdi. |
| C25 | OK con riserva (T17) | Un test fallisce anche su `main` (`test_mcp_tools_workouts::test_search_and_create_template`, conteggio `AuditEvent`). |
| C26 | OK (T17) | Ogni query filtra per `user_id`; 401 senza sessione. |
| C27 | OK | Gli esercizi archiviati sono inclusi nelle statistiche; c'è un test dedicato. |
| C28 | OK | `npm test` 345/345, `tsc -b` pulito, build ok. |
| C29 | PARZIALE | Ciclo `upgrade`/`downgrade -1`/`upgrade` della migrazione provato sul server. La suite pytest completa non è verde: 46 fallimenti di isolamento tra test, quasi tutti presenti anche su `main`. |
| C30 | OK (a vista) | T18; percorsi distinti per sezione. |
| C31 | OK | Placeholder nei percorsi finali e `art-prompts.md` completo (4 prompt più le varianti 3b e 4b). |

## Test

- `cd web && npm test`: 53 file, 345 test passati, 0 falliti.
- `cd web && npx tsc -b`: pulito.
- `cd web && npm run build`: ok.
- da `api/`:
  - `ruff check app tests`: pulito.
  - `import app.main`: ok.
  - `pytest tests/test_stats_rules.py`: 22 passati.
  - `pytest --collect-only`: 329 test raccolti.
- Sul server (T17), set della feature e dei comportamenti preservati: 82 passati, 1 fallito (preesistente su `main`).
- Sul server, suite completa: 46 fallimenti dovuti all'interferenza tra test, quasi tutti presenti anche su `main`. I test del peso che falliscono nella suite completa passano se eseguiti da soli.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- Nessuno

### MINOR
- `api/app/schemas/weight.py:8` — senza il campo `weight_kg` la risposta è 422 invece di 400. Correzione: `weight_kg: Any = None`.
- `api/app/services/gym_stats.py:119` — la colonna `latest_started` è selezionata ma non viene mai letta. Correzione: toglierla dalla select.
- `api/app/services/gym_stats.py:90` — la durata media usa `round()`, che arrotonda al pari. Correzione: arrotondare half-up, oppure documentare la scelta.
- `api/app/services/stats_rules.py:150,163` — un peso di 0 kg conta come zavorra e produce il record "Carico massimo 0 kg". Correzione: trattare 0 come assenza di zavorra.
- `web/src/components/stats/PersonalRecords.tsx:14` — la durata dei record è mostrata in secondi ("90 s"). Correzione: usare `formatDuration`, come nello Storico.
- `web/src/pages/gym/HistoryPage.tsx:74` — l'errore di eliminazione compare in cima alla pagina e non si vede con una lista lunga. Correzione: mostrarlo vicino alla card o scorrere fino al messaggio.
- `web/src/components/stats/WeightSection.tsx:42` — se l'eliminazione di una pesata fallisce non compare nessun messaggio. Correzione: aggiungere un messaggio di errore nel blocco.
- `web/src/lib/badges.ts:19` — `gymBadgeProgress` è usata solo nei test. Correzione: usarla in `BadgeGrid` oppure toglierla.
- `web/src/lib/usePeriodParams.ts:12` — il tipo `PeriodChoice` è definito anche in `PeriodPicker.tsx`. Correzione: importarlo da un solo posto.
- `web/src/components/stats/ProgressChart.tsx` — per volumi sopra 10 t con escursione sotto 1 t, le etichette compatte "k kg" arrotondano (10.250 diventa "10,3k"). Correzione: due decimali nel formato compatto.
- Altri dettagli dal registro:
  - niente focus trap nell'overlay del peso;
  - grafico vuoto, senza messaggio, se manca la metrica scelta;
  - media mobile con un solo punto non disegnata;
  - tabella del README non allineata;
  - manca un test REST 400 per periodo non valido su `/api/stats/gym/exercises/{id}`.

## Note

- T19, aggiunto su richiesta dell'utente durante T18, ha cambiato anche i grafici esistenti di Statistiche Dieta: asse Y, scala con valori tondi, dominio senza il vecchio margine ×1.1. Il cambiamento è voluto ma la spec non lo elenca tra i comportamenti che cambiano.
- Va aperto un `devflow:fix` per l'isolamento della suite pytest, che fallisce già su `main`. Dopo quella correzione va rieseguita la suite completa per chiudere davvero C29.
- In T17 un primo `downgrade -1` lanciato prima di `upgrade head` ha ricreato vuota la tabella `push_subscriptions`. Gli avvisi di fine riposo vanno riattivati sui dispositivi.
- In sospeso:
  - grafiche definitive: l'utente le genera con i prompt di `art-prompts.md` e le consegna in uno zip;
  - misura col cronometro del timer di riposo, che all'utente sembra scorrere più veloce del dovuto;
  - conferma a vista su iPhone della leggibilità degli assi dopo T19.
