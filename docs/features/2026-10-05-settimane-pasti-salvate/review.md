# Review: Settimane di pasti salvate

- Data: 2026-10-05
- Verdetto: APPROVED
- Diff: `7a42eed..a3c65c1`
- Reviewer: devflow-reviewer (sonnet/high)

## Criteri di accettazione

| Criterio | Esito | Note |
|---|---|---|
| C1 | OK | `create_saved_week` (`day_index = entry.date - start`, copia cibo, grammi, etichetta). |
| C2 | OK | `Invalid` per settimana vuota, non lunedì e nome vuoto, prima di ogni scrittura. `SaveWeekDialog` disabilita il salvataggio con nome vuoto. |
| C3 | OK | Elenco ordinato per `created_at`, `id` decrescenti. Pagina `/week/saved` con stato vuoto. |
| C4 | OK | Dettaglio con 7 giorni, totali via `compute_day_totals`, giorni vuoti a zero. |
| C5 | OK | `own_saved_week` dà 404. La pagina mostra "Settimana non trovata.". |
| C6 | OK | "Applica settimana…" apre il dialog con `days=null`. Riepilogo "Applicati N pasti in M giorni". |
| C7 | OK | `plan_apply` riusa `plan_copy`, mappatura posizionale. Barra "Applica N giorni…" con giorni ordinati. |
| C8 | OK | Posizioni successive in `append` (`_next_position`). |
| C9 | OK | `replace` cancella solo i pasti selezionati, anche con giorno salvato vuoto. |
| C10 | OK | "Applica" richiede data e almeno un pasto. |
| C11 | OK | Nutrienti correnti del cibo (`_adapt_item`). |
| C12 | OK | Rinomina con `clean_name`, elimina con `window.confirm`, `DiaryEntry` preservate. Vedi MINOR sul dettaglio. |
| C13 | OK | 403 su tutti gli endpoint. Web: `canCopy` e `PermissionGuard`. |
| C14 | OK | `useApplySavedWeek` invalida `["diary","week"]` e `["diary","day"]`. Controllo manuale su iPhone ancora da fare. |
| C15 | OK | `CopyDaysDialog` solo refattorizzato, test esistenti invariati e verdi. |
| C16 | OK | `plan_copy` e `copy_days` invariati. `test_diary_copy_service.py` verde. |
| C17 | OK | `test_diary_copy_permission.py` verde sul server. |
| C18 | OK | `AppShell.tsx` e `appMode.ts` non toccati. Nuovo test: tab Settimana attiva su `/week/saved`, 4 tab. |
| C19 | OK | `npm test` 385/385, `tsc -b` pulito. |
| C20 | OK (riportato) | Server, DB isolato `yfp_test`: 40/40 in 4 corse (`test_saved_weeks`, `test_saved_week_models`, `test_saved_week_rules`) e 12/12 (`test_diary_copy_permission`, `test_mcp_tools_diary`). |

## Test

- `cd web && npm test`: 60 file, 385 test passati, 0 falliti.
- `cd web && npx tsc -b`: nessun errore.
- `cd api && ruff check .`: OK.
- `pytest tests/test_saved_week_rules.py tests/test_diary_copy_service.py` (senza DB): 34 passati.
- Server (DB isolato): 40/40 su 4 corse e 12/12.
- Suite completa sul server: instabile per il problema di isolamento già noto (la fixture `db` usa il DB vivo del `.env`). `test_diary_copy.py:111` (`404 == 201`) fallisce anche sulla baseline `3061290`, quindi è preesistente.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- Nessuno

### MINOR
- `web/src/pages/SavedWeekDetailPage.tsx:51-53` — dopo l'eliminazione, l'invalidazione di `["saved-weeks"]` rilancia la query di dettaglio ancora attiva, che dà 404. Per un attimo compare "Settimana non trovata." prima del `navigate`. Correzione: `removeQueries` sul dettaglio prima di invalidare, oppure navigare prima.
- `web/src/pages/SavedWeekDetailPage.tsx:45-49` — un errore della rinomina non viene mostrato. Un nome oltre 100 caratteri dal `window.prompt` dà 400 senza feedback. Correzione: mostrare `rename.error` oppure `slice(0, 100)`.
- `web/src/pages/SavedWeeksPage.tsx:51` — `created_at.slice(0, 10)` mostra la data UTC, che può differire di un giorno da quella locale vicino a mezzanotte. Correzione: data locale con `new Date(...)`.
- `README.md:171-178` — le righe PATCH e DELETE della tabella API non sono allineate (solo formattazione).

## Note

- I problemi emersi nelle review per task (blocker sul totale del dettaglio in T5, valore `avg_kcal` sbagliato in un test) sono stati corretti prima del commit.
- Il fallimento instabile della suite completa sul server è il debito noto di isolamento dei test (la fixture `db` in `api/tests/conftest.py` lavora sul DB di `DATABASE_URL`). Follow-up suggerito: puntare i test a un DB dedicato.
- Scelte del piano da confermare: nome non valido come 400 (non 422), `CheckConstraint` 0..6 su `day_index`, rinomina via `window.prompt`.
- Resta aperto il controllo manuale su iPhone/PWA: salva una settimana, applicala in `append` e `replace`, barra "Applica N giorni…" sopra la tab bar, utente senza `diary.copy` senza comandi.
