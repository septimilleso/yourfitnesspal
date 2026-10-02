# Brainstorm: Statistiche palestra e peso giornaliero

- Data: 2026-10-02
- Stato: concluso

## Problema

L'utente si allena e segue la dieta nell'app, ma non vede i propri progressi. La pagina Statistiche della Palestra mostra solo la serie di aperture dell'app e il testo "Statistiche palestra in arrivo". I badge della Palestra seguono la serie di aperture, non gli allenamenti fatti. Il peso corporeo non è registrato da nessuna parte. Dalla lista Storico non si può cancellare un allenamento: oggi bisogna aprire il dettaglio e usare il menu "Elimina". Quando Claude analizza il peso via MCP, deve ricostruire le medie una pesata alla volta. Le medie mobili e settimanali sono i valori che contano.

Stato attuale rilevante:
- Gli esercizi custom eliminati sono solo archiviati (`archived_at`). Lo storico che li usa resta intatto, quindi il dato per le progressioni esiste già.
- `DELETE /api/workouts/{id}` esiste già e cancella qualsiasi allenamento dell'utente.
- I badge sono 30 immagini per sezione (`web/art/palestra/badges/01..30.png`). Oggi se ne sblocca 1 ogni 5 giorni di serie (`web/src/lib/badges.ts`).

## Obiettivo

In Statistiche Palestra l'utente vede quanti allenamenti ha fatto, con un badge ogni 10, e la progressione di ogni esercizio. Vede anche i record personali, il riepilogo di un periodo e la frequenza settimanale. Da entrambe le sezioni registra il peso del giorno con un tasto e un campo. In Statistiche Dieta vede andamento, media mobile e storico del peso. Claude legge via MCP medie già calcolate dal server per il peso e per la palestra.

## Requisiti emersi

Statistiche palestra (pagina `/gym/stats`):
- La card della serie di aperture viene tolta dalla Palestra. Al suo posto c'è una card "N allenamenti" con i badge palestra.
- Nuova regola per i badge palestra: 1 badge ogni 10 allenamenti finiti, 30 badge, collezione completa a 300. I badge della Dieta restano legati alla serie, come oggi.
- Riepilogo di un periodo, con preset 7/30/90 giorni o date custom come in Dieta: numero di allenamenti, volume totale (kg × reps), durata media.
- Frequenza settimanale: grafico a barre degli allenamenti per settimana.
- Progressione di un esercizio scelto: per ogni sessione carico massimo, 1RM stimato e volume, nel tempo. Sotto, lo storico delle serie.
- Record personali per esercizio: peso massimo, 1RM stimato, reps massime, ciascuno con la data.

Peso giornaliero:
- Tasto in alto a sinistra nell'header, in tutte e due le sezioni (simmetrico all'ingranaggio delle impostazioni a destra).
- Il tasto apre solo un campo dove scrivere il peso e una conferma che lo aggiunge per oggi. Nessuna sheet con grafici.
- Un solo peso per giorno: un nuovo inserimento nello stesso giorno sovrascrive il precedente.
- In Statistiche Dieta: grafico del peso con la media mobile a 7 giorni e lo storico delle pesate. Ogni pesata dello storico si può eliminare.

Storico allenamenti:
- Swipe a sinistra su una card della lista Storico mostra "Elimina". Dopo la conferma l'allenamento è cancellato. Il menu nel dettaglio resta.

MCP (calcoli lato server):
- `get_weight_history(from, to)`: pesate giornaliere con la media mobile a 7 giorni per ogni giorno, più le medie per settimana ISO con la variazione rispetto alla settimana prima.
- `get_exercise_progress(exercise_id, from, to)`: per sessione carico massimo, 1RM stimato e volume, più i PR.
- `get_gym_stats(from, to)`: allenamenti, volume, durata media e frequenza settimanale nel periodo.

## Vincoli

- Stack esistente: FastAPI + SQLAlchemy async + Alembic + Postgres, web React + TanStack Query + Tailwind, grafici SVG fatti a mano (`web/src/components/stats/`).
- Nessun Postgres locale: i test DB girano solo con pytest sul deploy remoto, via docker compose. In locale girano solo i test web (`cd web && npm test`).
- Serve una migrazione Alembic per la nuova tabella dei pesi: `user_id`, `date`, `weight_kg`, unica per (`user_id`, `date`).
- Il "giorno" del peso segue `settings.app_timezone` (Europe/Rome), come la serie di aperture.
- App multi-utente: ogni dato è filtrato per l'utente loggato. I tool MCP agiscono solo sull'utente autenticato.
- Pesi in kg con un decimale. Uso da iPhone come PWA: il tasto e il campo devono funzionare con la tastiera numerica di iOS.

## Fuori scope

- Più pesate nello stesso giorno, modifica di una pesata o inserimento per giorni passati (per correggere si elimina e si reinserisce oggi).
- Tool MCP `log_weight` e `delete_workout`.
- Obiettivo di peso, BMI, composizione corporea, unità diverse dai kg.
- Badge palestra con soglie crescenti. Modifiche ai badge e alla serie della Dieta.
- Cancellazione multipla di allenamenti.
- Riepiloghi precalcolati o tabelle di cache.

## Alternative considerate

### A. Calcolo server, servizio unico
Servizi `gym_stats` e `weights` nell'API con aggregazioni SQL, esposti da endpoint REST e riusati dai tool MCP. Il web disegna soltanto. — Pro: una sola logica per web e MCP (media 7gg, 1RM, PR), numeri sempre uguali tra app e Claude, il web non scarica tutto lo storico. — Contro: più endpoint e test DB, che girano solo sul deploy remoto. — Costo: L

### B. Calcolo nel web, MCP separato
Il web scarica lo storico e calcola in TypeScript, il server ricalcola in Python solo per MCP. — Pro: pochi endpoint, test veloci in vitest. — Contro: logica duplicata in due linguaggi, rischio di numeri diversi, lo storico paginato va scaricato tutto. — Costo: M-L

### C. Riepiloghi precalcolati
Tabella di riepilogo per esercizio e sessione, scritta quando l'allenamento finisce. — Pro: query molto veloci. — Contro: eccessivo per l'uso attuale, serve un backfill e la gestione di cancellazioni e modifiche. — Costo: L+

## Scelta

A. I tool MCP richiedono comunque il calcolo lato server. Metterlo lì una sola volta evita la duplicazione e garantisce che app e Claude mostrino gli stessi numeri. Vedi ADR 0002.

## Rischi e punti aperti

- Formula del 1RM stimato: proposta Epley (`peso × (1 + reps/30)`), calcolata solo per serie completate con peso e reps > 0. Da fissare nella spec.
- Esercizi a durata (es. plank) o a corpo libero senza peso: la progressione deve usare durata massima o reps massime. La spec deve definire la metrica per ogni tipo di tracking.
- Quali serie contano: solo le serie completate (`completed_at` non null) degli allenamenti finiti. Da confermare nella spec.
- Definizione della media mobile a 7 giorni con giorni mancanti: proposta media delle pesate presenti negli ultimi 7 giorni di calendario, giorno incluso, null se non ce n'è nessuna.
- Cancellare allenamenti fa scendere il conteggio, quindi un badge già sbloccato può tornare bloccato. È accettato: il badge riflette il totale reale.
- Lo swipe a sinistra può entrare in conflitto con lo scroll verticale e con il gesto "indietro" di iOS dal bordo. Serve una soglia orizzontale e un test su iPhone reale.
- Il tasto peso in alto a sinistra deve convivere con il `ModeSwitch` centrato, il cui padding `px-14` lascia già spazio su entrambi i lati.
- Le query di progressione su tutto lo storico vanno bene per pochi utenti. Se servisse, si aggiungono indici, senza cache.

## Decisioni registrate

- [0002. Statistiche calcolate lato server e condivise tra web e MCP](../../decisions/0002-statistiche-lato-server-condivise-web-mcp.md)
