# Spec: Massimo raggiunto sotto il precedente

- Data: 2026-10-07
- Tipo: feature
- Stato: completato
- Brainstorm: saltato

## Obiettivo

Durante un allenamento attivo, sotto il valore "Precedente" di ogni serie, l'utente vede in piccolo il massimo mai raggiunto in quella serie (1ª, 2ª, 3ª…) di quell'esercizio. Se attraversa un periodo di calo, ha per ogni serie un obiettivo da recuperare, non solo il valore della sessione scorsa.

## Contesto tecnico

Decisioni precedenti:

- La spec della palestra ([2026-09-24-gym-workouts-design.md](../../superpowers/specs/2026-09-24-gym-workouts-design.md), sezione "Precedente") definisce `previous_sets` (serie completate dell'ultimo allenamento finito con quell'esercizio), il campo `previous` per posizione su ogni serie, la riga `Serie | Precedente | kg | Rip. | ✓` e il tap su "Precedente" che copia i valori nei campi. Restano valide. Il massimo usa la stessa nozione di posizione del precedente.
- La spec delle statistiche ([2026-10-02-statistiche-palestra-peso](../2026-10-02-statistiche-palestra-peso/spec.md)) e l'[ADR 0002](../../decisions/0002-statistiche-lato-server-condivise-web-mcp.md): le statistiche vivono lato server e contano solo le serie completate degli allenamenti finiti dell'utente. Qui si contano le stesse serie.

Codice coinvolto:

- Backend. `api/app/services/workouts.py`: `previous_sets()` (una query per l'ultimo allenamento finito di ogni esercizio, una per le sue serie completate), `_previous_at()` e `workout_out()`, che per un allenamento `in_progress` calcola `previous` e lo mette su ogni `WorkoutSetOut`. `api/app/schemas/workout.py`: `WorkoutSetOut.previous`, `SetValues`.
- Web. `web/src/api/gym.ts` (tipi `WorkoutSet`, `SetValues`, `Tracking`), `web/src/lib/gym.ts` (`formatSet`, `setGridColumns`, `setFields`), `web/src/components/gym/SetRow.tsx` (cella "Precedente": bottone `truncate`, 14px grigio, `aria-label="Usa precedente serie N"`), `web/src/components/gym/WorkoutExerciseCard.tsx`, `web/src/pages/gym/WorkoutPage.tsx`. Test esistenti: `SetRow.test.tsx`, `WorkoutPage.test.tsx`, `lib/gym.test.ts`.
- `WorkoutDetailPage` (dettaglio di un allenamento finito) e i tool MCP non mostrano il precedente e non sono toccati.

Vincoli: ogni modifica live risponde con il `WorkoutOut` completo e il web sostituisce la cache con la risposta, quindi il massimo deve arrivare nello stesso payload (nessun endpoint o fetch aggiuntivo) e il calcolo non deve aggiungere una query per esercizio o per serie. Tracking esistenti: `weight_reps`, `reps` (con zavorra opzionale), `duration`. Uso principale da iPhone come PWA (larghezza utile circa 390px). Nessun Postgres locale: i test DB del backend (pytest) girano solo sul deploy remoto via docker compose.

### Definizione di "massimo raggiunto"

Il massimo è per esercizio e per posizione di serie, per l'utente autenticato.

- **Serie contate**: serie completate degli allenamenti finiti dell'utente con quell'esercizio. L'allenamento in corso è escluso, quindi il valore resta fisso per tutta la sessione.
- **Posizione**: come per il precedente. In ogni comparsa dell'esercizio in un allenamento finito, le serie completate ordinate per posizione sono la 1ª, la 2ª, la 3ª… Il massimo della serie N è il migliore tra le N-esime serie completate di tutte le comparse. Se un esercizio compare due volte nello stesso allenamento, contano entrambe le comparse.
- **Ordine "migliore"**:
  - `weight_reps` e `reps`: prima il peso più alto, poi a parità di peso più ripetizioni. Esempio: 90 × 5 > 90 × 4 > 80 × 8. Peso assente vale 0, quindi 0 kg × 15 > 0 kg × 12 e un esercizio a corpo libero ha comunque un massimo.
  - `duration`: la durata più lunga.
- **Formato**: lo stesso del precedente (`formatSet`), preceduto da "max". Esempi: `max 100 kg × 5`, `max 0 kg × 15`, `max 20 rip`, `max 1:30`.

Se nessuna comparsa ha una N-esima serie completata, la serie N non ha massimo e la seconda riga non compare.

## Impatto sull'esistente

- Comportamenti che cambiano: nella cella "Precedente" di ogni serie dell'allenamento attivo compare, sotto il valore precedente, una seconda riga piccola e grigia con il massimo di quella posizione. Le righe con un massimo diventano un po' più alte. La risposta di `WorkoutOut` per gli allenamenti in corso ha un campo in più per serie, accanto a `previous`.
- Comportamenti da preservare:
  - il valore "Precedente" resta com'è: testo, formato `80 kg × 8`, "—" se assente, tap che copia i valori nei campi, aria-label "Usa precedente serie N", bottone disabilitato senza precedente;
  - il massimo non si tocca per copiare: il tap sul precedente copia sempre il precedente, mai il massimo;
  - `setGridColumns` e il numero di colonne della griglia restano invariati: il massimo sta dentro la cella "Precedente", quindi su iPhone i campi kg/Rip. non si restringono e il tasto ✓ resta al suo posto;
  - valori iniziali di una serie nuova presi da `previous` (aggiunta esercizio, "+ Aggiungi serie") e `previous_sets` invariati nel comportamento;
  - salvataggio con debounce, spunta con invio dei valori, timer di riposo, superserie, menu azioni, note;
  - dettaglio e Storico degli allenamenti finiti: nessuna riga "max" e nessun massimo calcolato (si calcola solo per allenamenti `in_progress`, come `previous`);
  - permesso `workouts.use` e isolamento per utente: il massimo considera solo gli allenamenti dell'utente autenticato.
- Compatibilità: retrocompatibile. Si aggiunge un campo opzionale (`null` se assente) a ogni serie di `WorkoutOut`; nessun campo esistente cambia. Il web tratta un campo mancante come "nessun massimo", così una cache vecchia o un fixture di test senza il campo non rompe niente.
- Migrazioni: Nessuna (si calcola dalle tabelle esistenti, nessuna colonna o indice nuovo).

## Requisiti funzionali

- **R1**: Per ogni serie dell'allenamento in corso, l'API deve restituire il massimo della sua posizione (definizione sopra) nello stesso `WorkoutOut` che già porta `previous`. Il numero di query non deve dipendere dal numero di esercizi o di serie.
- **R2**: Il massimo deve contare solo serie completate di allenamenti finiti dell'utente. Serie incomplete, allenamenti di altri utenti e l'allenamento in corso non contano.
- **R3**: Il massimo segue l'ordine definito: per `weight_reps` e `reps` prima il peso (assente = 0), poi le ripetizioni; per `duration` la durata.
- **R4**: La cella "Precedente" deve mostrare, sotto il valore precedente, una riga "max <valore>" in testo più piccolo del precedente (circa 11-12px) e grigio, con lo stesso formato del precedente per quel tracking.
- **R5**: Se la serie non ha massimo, la seconda riga non compare e la cella ha lo stesso aspetto di oggi. Se la serie ha un massimo ma non un precedente, la cella mostra "—" e sotto il massimo.
- **R6**: La riga del massimo resta su una sola riga, con troncamento a ellissi se non entra, e non provoca overflow orizzontale su 390px. Non è interattiva.
- **R7**: Il valore si aggiorna a ogni risposta del server come gli altri dati dell'allenamento. Durante la sessione non cambia, perché le serie in corso sono escluse.

## Requisiti non funzionali

- Prestazioni: una sola query aggiuntiva per ogni risposta live, su tutti gli esercizi dell'allenamento insieme. `workout_out` viene chiamato dopo ogni modifica, quindi la query deve essere leggera (filtri su `user_id`, stato `finished`, `exercise_id IN (...)`).
- Accessibilità: uno screen reader legge il massimo in modo comprensibile (es. "Massimo serie 1: 100 kg × 5"). Il contrasto resta adeguato anche a testo piccolo.
- Nessuna nuova dipendenza.

## Criteri di accettazione

- **C1** (R1, R2, R3): Dato un utente con due allenamenti finiti sullo stesso esercizio a peso:
  - allenamento A, in ordine di posizione: 80 × 8 completata, 120 × 1 incompleta, 100 × 5 completata, 70 × 10 completata;
  - allenamento B: serie completate 90 × 6, 100 × 4;
  - e un allenamento in corso con quell'esercizio e 4 serie.

  Quando chiama `GET /api/workouts/active`, allora i massimi per posizione sono: serie 1 → 90 × 6, serie 2 → 100 × 5, serie 3 → 70 × 10, serie 4 → `null`. (Test DB in `api/tests/`, eseguito con pytest sul server remoto via docker compose.)
- **C2** (R3): Dato un esercizio con, in posizione 1, serie storiche 90 × 4, 90 × 5 e 80 × 8, allora il massimo della serie 1 è 90 × 5. Dato un esercizio `weight_reps` con serie a 0 kg di 12 e 15 rip, allora il massimo è 0 × 15. Dato un esercizio `duration` con 60 s e 90 s in posizione 1, allora il massimo è 90 s. (Test DB remoto o test unitario della regola di ordinamento.)
- **C3** (R2): Dato un secondo utente con serie più pesanti sullo stesso esercizio, quando il primo utente legge l'allenamento attivo, allora i suoi massimi non le includono. Dato un allenamento in corso con serie completate più pesanti dello storico, i massimi restano quelli dello storico. (Test DB remoto.)
- **C4** (R1): Dato un allenamento attivo con N esercizi diversi, quando si chiama `GET /api/workouts/active`, allora i massimi di tutte le serie arrivano nella stessa risposta e il numero di query aggiuntive non cresce con N. (Verifica nel test DB remoto e in review del codice.)
- **C5** (R4): Dato `SetRow` con tracking `weight_reps`, precedente 80 kg × 8 e massimo 100 kg × 5, quando si renderizza, allora nella stessa cella compaiono "80 kg × 8" e, sotto, "max 100 kg × 5". Con tracking `reps` e massimo 20 rip compare "max 20 rip"; con `duration` e massimo 90 s compare "max 1:30". (Test web: `npm test`.)
- **C6** (R5): Dato un `SetRow` con massimo assente o `null`, quando si renderizza, allora il testo "max" non è presente. Dato un set senza il campo (fixture esistenti, es. `WorkoutPage.test.tsx`), allora la riga si renderizza senza errori. Dato un set senza precedente ma con massimo, allora la cella mostra "—" e "max …". (Test web.)
- **C7** (R6): Dato un massimo con testo lungo, quando si renderizza, allora l'elemento del massimo ha classi di troncamento a riga singola e non è un `button`. Ispezione manuale su iPhone o viewport 390px: nessuno scroll orizzontale, campi e tasto ✓ allineati.
- **C8** (preservare): Dato un set con `previous` 77,5 kg × 8 e un massimo 100 kg × 5, quando si tocca "Usa precedente serie 1", allora i campi diventano 77,5 e 8 (non i valori del massimo) e dopo 500 ms parte il salvataggio come oggi. Il test `shows the previous values and copies them on tap` resta invariato e verde. Senza precedente la cella mostra "—" e il bottone è disabilitato.
- **C9** (preservare): `setGridColumns(n)` restituisce le stesse colonne di oggi e `SetRow` ha lo stesso numero di celle nella griglia. I test su debounce, spunta, eliminazione serie e riposo restano verdi.
- **C10** (preservare): Dato un allenamento finito, quando si apre `GET /api/workouts/{id}` o il dettaglio nello Storico, allora il payload non porta massimi calcolati (campo `null`) e non compare la riga "max". (Test DB remoto e test web.)
- **C11** (non regressione): Eseguendo `cd web && npm test`, tutti i test passano, anche quelli esistenti. La feature tocca il backend (`workouts.py`, `schemas/workout.py`): i test pytest corrispondenti non girano in locale. Vanno eseguiti sul server remoto via docker compose dopo il push del branch.

## Fuori scope

- Un unico massimo per esercizio uguale per tutte le serie.
- 1RM stimato o massimo per volume (peso × rep).
- Evidenziare in tempo reale che una serie in corso supera il massimo, o notifiche di nuovo record.
- Tap sul massimo per copiarlo nei campi.
- Modifiche alla pagina Statistiche, ai tool MCP, al dettaglio di un allenamento finito o al modello dati.

## Rischi

- Il payload live ha una query in più a ogni modifica, e la query legge tutto lo storico dell'esercizio. Mitigazione: una sola query aggregata su tutti gli esercizi dell'allenamento, che restituisce solo un valore per posizione, con filtri già indicizzati sulle FK. Si misura sul server remoto.
- La nozione di posizione deve coincidere con quella del precedente (N-esima serie completata). Se diverge, la riga "max" non corrisponde al precedente sopra. Mitigazione: il test C1 include una serie incompleta in mezzo allo storico.
- Righe più alte in una tabella già fitta su iPhone. Mitigazione: testo piccolo su una sola riga, solo quando il massimo esiste.
