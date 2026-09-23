# Server MCP con OAuth 2.1 per utente

## Problema

Gli utenti vogliono gestire la propria dieta (diario, alimenti, obiettivi) parlando con un
assistente AI (Claude.ai / app Claude, ChatGPT o altro client MCP remoto) invece che solo dalla
web app. Ogni utente deve collegare il **proprio** account, con le stesse garanzie di sicurezza del
login web (password + TOTP), e l'AI deve poter fare tutto ciò che l'utente può fare dall'app — e
niente di più.

## Decisioni

- **Client target:** connettori MCP remoti (Claude.ai, app Claude, ChatGPT). Trasporto
  *streamable HTTP* su `https://<dominio>/mcp`, autenticazione **OAuth 2.1** con Dynamic Client
  Registration (DCR) e PKCE, come richiesto dalla specifica MCP.
- **Funzionalità:** solo quelle già esistenti (ricerca/barcode/recenti/alimento custom, diario,
  settimana, copia giorni, obiettivi). Nessun nuovo modello di dominio.
- **Accesso:** nuovo permesso `mcp.access`, gestito dall'admin, **disattivato per default** per
  tutti gli utenti (esistenti e nuovi). L'admin è sempre abilitato (come per ogni permesso).
- **Implementazione:** SDK MCP ufficiale Python (`mcp`, `FastMCP`), montato dentro l'app FastAPI
  esistente. L'SDK fornisce gli endpoint OAuth standard; noi implementiamo il provider di storage
  su Postgres. Nessun container nuovo.

### Fuori scope

- Piano dieta settimanale, template pasto (`MealTemplate` resta non esposto).
- Tool di amministrazione via MCP.
- Scope OAuth granulari (sola lettura vs lettura+scrittura): un solo scope implicito.
- Trasporto stdio / token personali incollati a mano.

## Architettura

```
Claude ──HTTPS──► Cloudflare Tunnel ──► web (nginx) ──► api (FastAPI)
                                          │               ├─ /api/*            (REST esistente, cookie)
                                          │               ├─ /mcp              (FastMCP, Bearer)
                                          │               ├─ /.well-known/...  (metadata OAuth)
                                          │               └─ /register /authorize /token /revoke
                                          └─ /connect (SPA: login + consenso)
```

### File nuovi (API)

```
api/app/mcp/__init__.py
api/app/mcp/server.py        istanza FastMCP, registrazione tool/prompt, app ASGI da montare
api/app/mcp/oauth.py         PostgresOAuthProvider (implementa OAuthAuthorizationServerProvider)
api/app/mcp/context.py       current_user(): access token -> User, con tutti i controlli
api/app/mcp/tools/foods.py   tool alimenti
api/app/mcp/tools/diary.py   tool diario
api/app/mcp/tools/goals.py   tool obiettivi
api/app/models/oauth.py      OAuthClient, OAuthAuthCode, OAuthToken
api/app/routers/oauth.py     endpoint usati dalla SPA: consenso + connessioni utente/admin
api/app/schemas/oauth.py
api/alembic/versions/<rev>_oauth_mcp.py
```

### Estrazione della logica in `services/`

Oggi la logica di business vive nei router (`routers/diary.py`, `routers/foods.py`). Va estratta
in funzioni di servizio che ricevono `(db, user, ...)` e sollevano eccezioni di dominio, così REST
e MCP condividono un'unica implementazione:

- `services/diary.py`: `get_day`, `get_week`, `create_entry`, `update_entry`, `delete_entry`,
  `copy_days` (le funzioni pure esistenti restano).
- `services/goals.py` (nuovo): `get_active_goal`, `set_goal`.
- `services/foods.py` (nuovo): `search_foods`, `get_by_barcode`, `recent_foods`,
  `create_custom_food`.
- Eccezioni di dominio in `services/errors.py`: `NotFound`, `Invalid(message)`,
  `PermissionMissing(permission)`, `UpstreamUnavailable`. I router le traducono negli stessi
  status code e `detail` di oggi; i tool MCP in errori di tool leggibili.

Vincolo: le route REST mantengono esattamente comportamento, status code e payload attuali; i test
REST esistenti devono passare **senza modifiche**.

### Montaggio

- `main.py` monta l'app ASGI di FastMCP (`streamable_http_app()`) in modo che siano serviti
  `/mcp`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`,
  `/register`, `/authorize`, `/token`, `/revoke`. Il `lifespan` di FastAPI avvia anche il session
  manager di FastMCP.
- Il middleware CSRF esistente si applica solo a `/api/*`: non tocca gli endpoint OAuth/MCP
  (protetti da PKCE e Bearer).
- I tool accedono all'`OffClient` condiviso (`app.state.off_client`), così il rate limit OFF resta
  unico per processo.
- Protezione DNS rebinding dell'SDK attiva, con host/origin consentiti derivati da
  `PUBLIC_BASE_URL`.

### Configurazione (nuove variabili)

| Variabile | Default | Uso |
|---|---|---|
| `PUBLIC_BASE_URL` | `http://localhost:6500` | issuer OAuth e resource URL (`<base>/mcp`) |
| `APP_TIMEZONE` | `Europe/Rome` | calcolo di "oggi" nei tool |
| `OAUTH_ACCESS_TOKEN_MINUTES` | `60` | durata access token |
| `OAUTH_REFRESH_TOKEN_DAYS` | `30` | durata refresh token |

Documentate in `.env.example` e README.

### nginx

`web/nginx.conf` aggiunge `location` verso `api:8000` per `/mcp`, `^~ /.well-known/oauth-`,
`= /register`, `= /authorize`, `= /token`, `= /revoke`, con `proxy_buffering off`,
`proxy_read_timeout` lungo e gli stessi header `X-Real-IP` / `X-Forwarded-*` di `/api/`.
`/connect` resta servito dalla SPA (fallback `index.html`).

## Modello dati

Una migration Alembic.

**`oauth_clients`**
- `id` PK, `client_id` (string univoca, generata), `client_secret_hash` (nullable; i client
  pubblici non hanno secret), `client_name`, `redirect_uris` (JSONB), `metadata` (JSONB, il resto
  del payload DCR), `created_at`.

**`oauth_auth_codes`**
- `id` PK, `code_hash` (sha256, univoco), `client_id` FK, `user_id` FK (CASCADE),
  `redirect_uri`, `redirect_uri_provided_explicitly`, `code_challenge`, `scopes` (JSONB),
  `resource` (nullable), `expires_at` (5 minuti), `used_at` (nullable).

**`oauth_tokens`**
- `id` PK, `user_id` FK (CASCADE), `client_id` FK (CASCADE), `family_id` (uuid, condiviso tra un
  refresh e i suoi successori), `access_token_hash` (univoco), `access_expires_at`,
  `refresh_token_hash` (univoco), `refresh_expires_at`, `auth_version`, `created_at`,
  `last_used_at`, `revoked_at` (nullable), `rotated_at` (nullable).
- Una riga = una coppia access/refresh. La rotazione marca la riga `rotated_at` e ne crea una
  nuova nella stessa famiglia.

I token e i codici sono salvati **solo come hash** (come `user_sessions`); i valori in chiaro
esistono solo nella risposta al client.

**Permessi:** `Permission.mcp_access = "mcp.access"` con label "Connessioni AI (MCP)".
`DEFAULT_PERMISSIONS` viene ridefinito come `frozenset(Permission) - {Permission.mcp_access}`, così
i nuovi utenti non lo ricevono. Nessuna modifica ai dati degli utenti esistenti.

## Flusso OAuth

1. L'utente aggiunge `https://<dominio>/mcp` come connettore. Il client ottiene 401 con
   `WWW-Authenticate` che punta a `/.well-known/oauth-protected-resource`, poi legge il metadata
   dell'authorization server.
2. **DCR** (`/register`): il provider salva il client. Validazione `redirect_uris`: solo `https://`
   oppure `http://localhost` / `http://127.0.0.1` (qualsiasi porta). Altrimenti errore
   `invalid_redirect_uri`.
3. **Authorize** (`/authorize`): l'SDK valida client, redirect URI (match esatto) e PKCE
   (solo `S256`). Il provider serializza i parametri (client_id, redirect_uri, code_challenge,
   state, scopes, resource) firmandoli con `app_key` (itsdangerous, salt `oauth-authorize`,
   validità 10 minuti) e risponde con redirect a `/connect?req=<firmato>`.
4. **SPA `/connect`**: se non c'è sessione, redirect a `/login?next=/connect?req=...`; dopo login
   (password + TOTP, flusso esistente) torna a `/connect`. La pagina chiama
   `GET /api/oauth/consent?req=...` per ottenere nome client e utente, e mostra la richiesta.
5. **Consenso** `POST /api/oauth/consent` `{req, approve}` (cookie di sessione + header CSRF):
   - `req` non valido/scaduto → 400.
   - utente senza `mcp.access` → 403 `mcp_access_missing`.
   - `approve=false` → risponde `{redirect_url}` verso il client con `error=access_denied`.
   - `approve=true` → crea `oauth_auth_codes`, registra audit `mcp.connect`, risponde
     `{redirect_url}` con `code` e `state`.
   La SPA fa `window.location.assign(redirect_url)`.
6. **Token** (`/token`, `authorization_code`): verifica codice (hash, non scaduto, non usato,
   client e redirect coincidenti, PKCE verificato dall'SDK). Marca `used_at` ed emette la coppia
   access/refresh con `auth_version` corrente dell'utente. Un codice già usato → rifiuto **e**
   revoca di tutti i token della coppia utente+client.
7. **Refresh** (`/token`, `refresh_token`): se il refresh è valido e non ruotato → nuova coppia
   nella stessa famiglia, vecchia riga `rotated_at`. Se il refresh è già ruotato (riuso) →
   revoca dell'intera famiglia e rifiuto.
8. **Revoke** (`/revoke`): marca `revoked_at` sulla riga.

### Validazione dell'access token (ogni chiamata a `/mcp`)

Il token è valido solo se **tutte** le condizioni reggono:
- hash presente, `revoked_at` e `rotated_at` nulli, `access_expires_at` futuro;
- utente `is_active`;
- `auth_version` della riga uguale a quella dell'utente (cambio password, reset TOTP, reset admin
  lo invalidano);
- l'utente ha `mcp.access` in `effective_permissions`.

`last_used_at` aggiornato al massimo ogni 5 minuti (come le sessioni).

### Revoca

- L'utente revoca le proprie connessioni da Account; l'admin quelle di qualsiasi utente.
- `DELETE /api/admin/users/{id}/sessions` (revoca sessioni esistente) revoca anche tutti i token
  OAuth dell'utente.
- Eliminazione utente → CASCADE.

### Rate limiting

`auth/rate_limit.py` oggi usa un solo dizionario per IP dedicato al login. Viene generalizzato con
un parametro `bucket` (default `"login"`, comportamento invariato) e usato con bucket distinti per
`/register` e `/token` (es. 20 richieste/minuto per IP) e per `POST /api/oauth/consent`.

### Pulizia

Nuovo comando `python -m app.cli purge-oauth`: elimina codici scaduti/usati da più di 1 giorno e
token con refresh scaduto o revocati/ruotati da più di 30 giorni. Inoltre la stessa pulizia dei
codici scaduti avviene in modo opportunistico a ogni emissione di codice.

## Tool MCP

Tutti i tool operano **solo** sull'utente del token; nessun argomento `user_id`. Nomi, descrizioni
e argomenti in inglese. Output JSON compatto con nutrienti arrotondati a 1 decimale e nomi degli
alimenti inclusi. Le date sono ISO `YYYY-MM-DD`; dove indicato, il default è "oggi" in
`APP_TIMEZONE`. `meal` è uno tra `breakfast` (colazione), `lunch` (pranzo), `dinner` (cena),
`snack` (spuntino): la mappatura italiana è scritta nella descrizione del tool.

| Tool | Argomenti | Permesso richiesto |
|---|---|---|
| `search_foods` | `query`, `limit` (1–20, default 10) | nessuno; senza `foods.off_lookup` cerca solo nella cache locale |
| `get_food_by_barcode` | `barcode` | `foods.off_lookup` se il cibo non è già in cache |
| `get_recent_foods` | `limit` (1–20, default 10) | – |
| `create_custom_food` | `name`, `brand?`, `kcal`, `protein_g`, `carbs_g`, `fat_g` (per 100 g), `fiber_g?`, `sugars_g?`, `salt_g?` | `foods.custom_create` |
| `get_day` | `date?` | – ; voci per pasto (con `entry_id`), totali, obiettivo attivo, delta |
| `get_week` | `date?` (qualsiasi giorno della settimana) | – |
| `add_diary_entry` | `date?`, `meal`, `food_id`, `grams` | – |
| `add_diary_entries` | `entries`: lista (1–30) di `{date?, meal, food_id, grams}` | – ; tutto o niente (una transazione) |
| `update_diary_entry` | `entry_id`, `grams?`, `meal?` | – |
| `delete_diary_entry` | `entry_id` | – |
| `copy_days` | `source_dates`, `target_start`, `meals?`, `mode` (`append`/`replace`) | `diary.copy` |
| `get_goal` | `date?` | – |
| `set_goal` | `kcal`, `protein_g`, `carbs_g`, `fat_g` | `goals.edit` |

Le validazioni (grammi > 0, limiti numerici, ecc.) sono quelle dei servizi condivisi, quindi
identiche alla REST.

### Prompt MCP

`plan_my_day(date?)`: istruisce l'assistente a leggere obiettivo e giorno, proporre i pasti
mancanti per rientrare nei macro, chiedere conferma all'utente e solo dopo registrarli con
`add_diary_entries`.

### Errori

- Eccezioni di dominio → risultato di tool con `isError` e messaggio leggibile, es.
  `"Food 123 not found"`, `"Permission diary.copy is not enabled for this account"`,
  `"OpenFoodFacts is unreachable, try again later"`.
- Entità di un altro utente → stesso messaggio di "not found" (nessuna fuga di informazioni).
- Eccezioni inattese → messaggio generico `"Internal error"`, stack trace solo nei log.

### Audit

Via `services/audit.record`:
- `mcp.connect` (consenso approvato), `mcp.revoke` (revoca da utente/admin), `mcp.token_reuse`
  (riuso codice o refresh rilevato).
- Ogni tool di scrittura (`add_*`, `update_*`, `delete_*`, `copy_days`, `create_custom_food`,
  `set_goal`) registra un evento `mcp.<tool>` con `details = {"client": <client_name>, ...}`.

## API per la SPA

Tutte sotto `/api/oauth`, cookie di sessione, header CSRF per i metodi non-GET.

- `GET /api/oauth/consent?req=...` → `{client_name, redirect_host, user: {username, display_name},
  has_permission}`.
- `POST /api/oauth/consent` `{req, approve}` → `{redirect_url}`.
- `GET /api/oauth/connections` → lista connessioni attive dell'utente, raggruppate per client:
  `{client_id, client_name, connected_at, last_used_at}`.
- `DELETE /api/oauth/connections/{client_id}` → revoca tutti i token dell'utente per quel client.
- Admin: `GET /api/admin/users/{id}/mcp-connections`,
  `DELETE /api/admin/users/{id}/mcp-connections` (revoca tutte).

## UI (web)

- **`/connect`** (nuova pagina `ConnectPage`, fuori da `AppShell`, stile di `LoginPage`):
  nome del client, host di redirect, utente loggato, elenco di cosa potrà fare ("leggere e
  modificare diario, alimenti e obiettivi"), bottoni **Autorizza** / **Nega**. Se
  `has_permission=false` mostra "Chiedi all'amministratore di abilitare le connessioni AI" e solo
  un bottone per annullare (che nega). `req` scaduto → messaggio "Richiesta scaduta, riprova dal
  tuo assistente".
- **Login**: supporto al parametro `next` (solo path relativi interni, per evitare open
  redirect) per tornare a `/connect` dopo il login.
- **Account → sezione "Connessioni AI"**: visibile solo con `mcp.access`. URL da copiare
  (`<PUBLIC_BASE_URL>/mcp`, esposto come nuovo campo `mcp_url` nella risposta di
  `GET /api/auth/me`), breve guida
  (Claude → Impostazioni → Connettori → Aggiungi connettore personalizzato), lista connessioni con
  ultimo uso e **Revoca**.
- **Admin → utente**: il permesso compare automaticamente tramite `PERMISSION_LABELS`; nuova
  sottosezione connessioni MCP con **Revoca tutte**.

## Test

**API (pytest)**
- Provider OAuth: DCR valido e con redirect non consentito; flusso completo authorize → consenso
  → token con PKCE; verifier errato; codice scaduto; codice riusato (rifiuto + revoca); redirect
  URI diverso; refresh con rotazione; riuso di refresh ruotato (revoca famiglia); revoke.
- Validazione access token: scaduto, revocato, utente disattivato, `auth_version` cambiata,
  permesso `mcp.access` rimosso.
- Consenso: senza sessione 401; senza permesso 403; senza header CSRF 403; `req` manomesso o
  scaduto 400; deny restituisce `error=access_denied`.
- Tool: ogni tool invocato tramite il client MCP in-memory dell'SDK con un token valido;
  isolamento tra utenti (A non legge né modifica voci di B); permessi mancanti producono errore;
  `add_diary_entries` atomico.
- Revoca sessioni admin revoca anche i token OAuth.
- Refactor servizi: suite REST esistente verde senza modifiche.
- `rate_limit` con bucket: il comportamento del login resta invariato.

**Web (vitest)**
- `ConnectPage`: approva, nega, permesso mancante, richiesta scaduta, redirect a login senza
  sessione.
- `LoginPage`: `next` interno rispettato, `next` esterno ignorato.
- Account: lista connessioni e revoca.

## Criteri di accettazione

1. Un utente con `mcp.access` aggiunge `<PUBLIC_BASE_URL>/mcp` in Claude.ai, fa login con password
   + TOTP, autorizza, e può chiedere "aggiungi 80 g di pasta a pranzo oggi": la voce compare nella
   web app.
2. Un utente senza `mcp.access` non può completare il collegamento.
3. Cambio password, reset TOTP, disattivazione, revoca permesso o revoca connessione bloccano
   immediatamente le chiamate MCP successive.
4. Nessun tool permette di leggere o modificare dati di un altro utente.
5. Tutti i test esistenti e nuovi passano; `ruff` pulito.
