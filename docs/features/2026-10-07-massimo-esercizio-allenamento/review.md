# Review: Massimo raggiunto sotto il precedente

- Data: 2026-10-08
- Round: 1
- Verdetto: APPROVED
- Diff: `4a7376d..5f87ac4`
- Reviewer: devflow-reviewer (sonnet/high)

## Criteri di accettazione

| Criterio | Esito | Note |
|---|---|---|
| C1 | OK | `test_max_set_per_position` ricostruisce lo scenario della spec (A con serie incompleta in mezzo, B, allenamento in corso) e attende (90,6), (100,5), (70,10), None. Test DB verde secondo l'utente sul remoto; logica coerente alla lettura del codice. |
| C2 | OK | `test_max_set_ordering`: 90×5 su 90×4 e 80×8, 0×15 su 0×12, durata 90 su 60. Verde secondo l'utente. |
| C3 | OK | `test_max_set_ignores_other_users_and_active_workout`: altro utente 200×20 e serie in corso 300×30 non cambiano il massimo (80×8). Verde secondo l'utente. |
| C4 | OK | Una sola query per tutti gli esercizi (`IN (...)`), verificata da `test_max_set_single_query` e dalla lettura del codice. |
| C5 | OK | Test SetRow per `weight_reps` ("80 kg × 8" e "max 100 kg × 5"), `reps` ("max 20 rip"), `duration` ("max 1:30"). |
| C6 | OK | `max_set` null e assente: nessun "max"; fixture di `WorkoutPage.test.tsx` senza campo rendono senza errori; "—" più "max …" senza precedente. |
| C7 | OK | Classi `block truncate text-center text-[11px]`, elemento `SPAN`, non `button` (test). Nessun overflow orizzontale, campi e ✓ allineati su iPhone secondo l'utente. |
| C8 | OK | Il tap copia 77,5 e 8 anche con massimo presente, salvataggio dopo 500 ms; senza precedente "—" e bottone disabilitato. Test originale esteso, non rimosso (vedi MINOR). |
| C9 | OK | `setGridColumns(1)` e `(2)` bloccati da test di caratterizzazione; la riga ha 5 figli diretti di griglia. |
| C10 | OK | `max_set` è `None` per allenamenti finiti (`test_max_set_none_for_finished_workout`, verde secondo l'utente); il dettaglio non mostra "max" (test web). |
| C11 | OK | `npm test` 400/400, build ok, ruff pulito; pytest DB verdi secondo l'utente sul remoto. |

## Test

- `cd web && npm test`: 61 file, 400 test passati, 0 falliti (eseguito dal reviewer).
- `cd web && npm run build`: ok.
- `ruff check api/app api/tests`: nessun errore.
- `pytest api/tests/test_gym_rules.py api/tests/test_stats_rules.py`: 33 passati.
- `pytest tests/test_workouts_live.py tests/test_workouts_finish.py` su DB isolato `yfp_test` (server remoto, docker compose): tutti verdi secondo l'utente, non rieseguiti dal reviewer (nessun Postgres locale).
- Controllo manuale su iPhone: ok secondo l'utente.

## Problemi

### BLOCKER
- Nessuno

### MAJOR
- Nessuno

### MINOR
- `web/src/components/gym/SetRow.tsx:117` — La riga "max" usa `text-slate-400` a 11px. Il contrasto su bianco è circa 2,6:1, sotto il 4,5:1 di WCAG AA. Il requisito non funzionale chiede un contrasto adeguato anche a testo piccolo. Il colore è coerente con il "Precedente" esistente (14px), ma a 11px pesa di più. Correzione: `text-slate-500` solo per la riga max, aggiornando la stringa di classi attesa in `SetRow.test.tsx`.
- `web/src/components/gym/SetRow.test.tsx` — Il test `shows the previous values and copies them on tap`, che C8 chiedeva invariato, è stato esteso con `max_set` e un'asserzione su "Rip. serie 1". Le asserzioni originali sono intatte e il test copre meglio C8: deviazione formale e benigna, nessuna azione.

## Note

- Nessuna migrazione, nessun indice nuovo: le FK e `ix_workouts_user_finished` coprono i filtri di `best_sets()`.
- La query aggiuntiva legge tutto lo storico degli esercizi dell'allenamento a ogni risposta live, ma restituisce una riga per posizione. Per uso personale è accettabile; rischio già dichiarato in spec.
- Altri consumer di `WorkoutSetOut`/`WorkoutOut` (router, tool MCP `_workout()`) non sono toccati dal nuovo campo, che ha default `None`. I tipi web sono scritti a mano, nessun tipo generato da aggiornare.
- Follow-up possibile: contrasto della riga max (MINOR sopra).
