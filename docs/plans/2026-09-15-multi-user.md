# Sistema multi-utente con credenziali, TOTP e pannello admin — Piano di implementazione

> **Per l'agente che implementa (Codex):** esegui i task in ordine. Ogni task termina con test verdi
> e un commit (Conventional Commits, es. `feat(api): ...`). Gli step usano checkbox (`- [ ]`): spuntali
> man mano. Non saltare i test di isolamento dati (Task 7): sono il cuore della sicurezza della feature.
> Se una decisione del piano risulta impossibile nel codice reale, fermati e documenta la deviazione
> in fondo a questo file (sezione *Deviazioni*) prima di proseguire.

**Branch:** `feature/multi-user`, creato da `feature/edit-diary-entry` (che non è ancora in `main`: la
PATCH delle entry e `EditEntrySheet` fanno parte della base).

**Obiettivo:** trasformare YourFitnessPal da app a chiave condivisa (`APP_KEY`) ad app multi-utente.

- Gli utenti li crea e gestisce **solo l'admin**. Nessuna registrazione pubblica.
- Login con **username + password**, poi **codice TOTP** (app authenticator). TOTP obbligatorio per tutti.
- L'admin ha un **pannello di gestione utenti**: crea, modifica, disattiva, elimina utenti, assegna ruolo e
  permessi, resetta password e TOTP, revoca sessioni.
- **Tutti i dati esistenti** (diario, obiettivi, alimenti custom, meal template) diventano dell'admin.

**Architettura in breve:** nuove tabelle `users`, `user_sessions`, `recovery_codes`, `audit_log`.
Colonna `user_id` su `diary_entries`, `goals`, `meal_templates`; colonna `owner_user_id` su `foods` (solo
alimenti custom). Sessioni lato server (token random nel cookie, hash SHA-256 in DB) al posto del cookie
firmato con itsdangerous. Autenticazione applicata tramite dependency FastAPI (non più middleware), con un
test che verifica che ogni route non pubblica sia protetta. Frontend: login multi-step, contesto utente
(`/api/auth/me`), pagina account, pagina admin `/admin/users`.

**Tech stack:** FastAPI + SQLAlchemy async + Alembic + Postgres 16; React 18 + TS + Vite + React Query +
Tailwind; pytest (Postgres reale) e vitest.

---

## Decisioni di design (già prese — non rimetterle in discussione)

1. **Ruoli:** `admin` e `user`. `admin` ha implicitamente tutti i permessi più la gestione utenti.
2. **Permessi granulari** (solo per ruolo `user`, lista in `users.permissions`, JSONB array di stringhe):

   | Permesso              | Cosa abilita                                                                  | Default nuovo utente |
   | --------------------- | ----------------------------------------------------------------------------- | -------------------- |
   | `foods.off_lookup`    | Chiamate a OpenFoodFacts (search con fallback OFF, barcode non in cache)       | sì                   |
   | `foods.custom_create` | `POST /api/foods` (creare alimenti custom)                                     | sì                   |
   | `diary.copy`          | `POST /api/diary/copy` (copia giorni/settimane)                                | sì                   |
   | `goals.edit`          | `PUT /api/goals` (modificare i propri obiettivi)                               | sì                   |

   Senza `foods.off_lookup` la ricerca usa solo la cache locale (`off_unavailable` resta `false`, si
   aggiunge `off_disabled: true` alla risposta) e il barcode risponde 404 se non già in cache.
   Senza `goals.edit` l'utente vede gli obiettivi ma solo l'admin può impostarli (endpoint admin dedicato).
   Il registro permessi vive in un solo posto: `api/app/permissions.py`.
3. **Alimenti:** il catalogo OFF (`source="off"`) è **condiviso** tra utenti. Gli alimenti **custom** sono
   **privati** del creatore (`owner_user_id`). Ricerca, recenti e creazione entry filtrano per visibilità.
4. **Diario, obiettivi, meal template:** strettamente per utente. Accesso a risorse di altri utenti ⇒ **404**
   (mai 403, per non rivelare l'esistenza).
5. **Nessuna impersonazione** e nessuna vista admin sui diari altrui (fuori scope).
6. **TOTP obbligatorio.** Un utente senza TOTP configurato, dopo la password, entra nel flusso di setup e non
   ottiene una sessione finché non conferma un codice valido.
7. **Password:** hash Argon2id (`argon2-cffi`). Lunghezza 12–128 caratteri. Nessun'altra regola di complessità.
8. **Password temporanea:** l'admin crea l'utente, il server genera una password temporanea mostrata **una
   sola volta**. `must_change_password=true` ⇒ al primo login l'utente deve cambiarla (nello stesso flusso
   del setup TOTP).
9. **Recovery codes:** 10 codici monouso generati alla conferma del TOTP, salvati come SHA-256 (sono ad alta
   entropia, Argon2 non serve). Utilizzabili al posto del TOTP. Rigenerabili dalla pagina account.
10. **Segreto TOTP cifrato a riposo** con Fernet (`cryptography`), chiave derivata da `APP_KEY` via HKDF-SHA256
    (info `b"yfp-totp-secret"`). **Conseguenza da documentare:** cambiare `APP_KEY` invalida tutti i TOTP
    (tutti devono rifare il setup; l'admin lo fa via CLI).
11. **`APP_KEY` non è più una password.** Resta solo come segreto server (firma del challenge di login e
    derivazione chiave TOTP). Il login con `{ "key": ... }` viene rimosso.
12. **Sessioni lato server** (`user_sessions`): cookie `session` = 32 byte random url-safe; in DB solo
    `sha256(token)`. Scadenza sliding 30 giorni, `last_seen_at` aggiornato al massimo ogni 5 minuti.
    Revoca = delete della riga. Utente disattivato o `auth_version` cambiato ⇒ sessioni invalide.
13. **Challenge di login** (tra password e TOTP): cookie `login_challenge` firmato con itsdangerous
    (`URLSafeTimedSerializer`, salt `login-challenge`), payload `{uid, stage, av}` dove `stage ∈ {"totp",
    "setup"}` e `av = users.auth_version`. Durata 5 minuti, `HttpOnly`, `SameSite=Strict`, `Path=/api/auth`.
14. **Anti-CSRF:** oltre a `SameSite=Lax`, ogni richiesta con metodo non sicuro (`POST/PUT/PATCH/DELETE`)
    verso `/api/*` deve avere header `X-Requested-With: yfp`; altrimenti 403. Il client lo aggiunge sempre.
15. **Rate limiting:** si mantiene il limitatore in memoria per IP (5 fallimenti/minuto) su `/login`,
    `/totp`, `/setup/complete`. In più, lockout per utente in DB: 10 fallimenti consecutivi (password o
    TOTP) ⇒ `locked_until = now + 15 min`. Il login riuscito azzera il contatore. Risposta per utente
    bloccato: 429 `{"detail": "account temporaneamente bloccato"}`.
16. **Messaggi di errore di login uniformi:** username inesistente, password errata, utente disattivato,
    utente senza password ⇒ sempre 401 `{"detail": "credenziali non valide"}`. Per l'username inesistente
    eseguire comunque una verifica Argon2 su un hash fittizio (tempi uniformi).
17. **Username:** minuscolo, regex `^[a-z0-9._-]{3,32}$`, univoco. `display_name` libero (1–64 caratteri).
18. **Bootstrap admin:** la migration crea l'utente `admin` (ruolo admin, `password_hash = NULL`,
    `must_change_password = true`) e gli assegna tutti i dati esistenti. La password si imposta via CLI
    (`python -m app.cli set-password admin`). Al primo login l'admin configura il TOTP. L'username è
    rinominabile dal pannello.
19. **Guardie admin:** un admin non può disattivare, eliminare o degradare se stesso; il sistema rifiuta
    qualsiasi operazione che lasci zero admin attivi (409).
20. **Eliminazione utente:** hard delete con cascade su diario, obiettivi, meal template, sessioni, recovery
    codes. Alimenti custom dell'utente: FK `owner_user_id` con `ON DELETE SET NULL`; gli alimenti custom
    senza owner restano in DB (possono essere referenziati da vecchie entry) ma diventano invisibili a
    tutti. Nel pannello: conferma digitando l'username.
21. **Audit log** minimale: login riuscito/fallito, setup TOTP, cambio password, tutte le azioni admin. Solo
    lettura dal pannello (ultimi 200 eventi). Nessuna rotazione automatica (fuori scope).
22. **Cache client e PWA:** al logout e al login si svuota la cache di React Query (`queryClient.clear()`) e
    la cache Workbox `api-foods-cache` (`caches.delete`). La runtime cache Workbox si limita a
    `/api/foods/search` e `/api/foods/barcode/` (esclude `/api/foods/recent`, dato per utente).
23. **Lingua UI:** italiano, come il resto dell'app. Identificatori di codice in inglese.

---

## Vincoli globali

- Backend in `api/`, comandi da `api/`. Test: `pytest` (serve `DATABASE_URL` verso un Postgres di test con
  migration applicate, come oggi). Lint: `ruff check .`. Linea max 100.
- Frontend in `web/`, comandi da `web/`. Test: `npm test`. Build/type-check: `npm run build`.
- Le migration sono **scritte a mano** (vedi commento in `162b1885de07`): niente autogenerate. Tieni modelli
  e migration allineati.
- Stile: segui docstring e commenti del codice esistente (spiegano il *perché*). Niente librerie frontend
  nuove salvo quelle elencate qui.
- Nuove dipendenze backend (in `api/pyproject.toml`): `argon2-cffi>=23.1`, `pyotp>=2.9`, `segno>=1.6`
  (QR code SVG, pure Python), `cryptography>=43`.
- Nessuna nuova dipendenza frontend (il QR arriva dal backend come SVG data URI).
- Prima di toccare un DB di produzione: `pg_dump`. Il README (Task 14) deve dirlo.

---

## Struttura file

### Backend — nuovi file

- `api/app/models/user.py` — `User`, `UserSession`, `RecoveryCode`, `AuditEvent`, enum `Role`.
- `api/app/permissions.py` — enum `Permission`, label italiane, default, `effective_permissions(user)`.
- `api/app/auth/passwords.py` — hash/verify Argon2, `generate_temp_password()`, dummy hash.
- `api/app/auth/totp.py` — generazione segreto, cifratura Fernet, verify con anti-replay, URI otpauth, QR SVG.
- `api/app/auth/sessions.py` — create/lookup/touch/revoke sessioni; challenge firmato.
- `api/app/auth/recovery.py` — generazione e consumo recovery codes.
- `api/app/auth/deps.py` — `get_current_user`, `require_admin`, `require_permission(p)`.
- `api/app/auth/rate_limit.py` — limitatore per IP spostato da `routers/auth.py` + helper lockout utente.
- `api/app/services/audit.py` — `record(session, actor, action, target_user_id, details)`.
- `api/app/routers/admin.py` — endpoint `/api/admin/*`.
- `api/app/schemas/auth.py`, `api/app/schemas/admin.py`.
- `api/app/cli.py` — comandi `set-password`, `reset-totp`, `create-admin`, `list-users`.
- `api/alembic/versions/<rev>_multi_user.py` — migration.
- `api/tests/conftest.py` — fixture condivise (`session`, `make_user`, `authed_client`).
- `api/tests/test_auth_flow.py`, `test_admin_router.py`, `test_isolation.py`, `test_permissions.py`,
  `test_totp.py`, `test_route_protection.py`, `test_cli.py`.

### Backend — file modificati

- `api/app/main.py` — rimuove il middleware cookie, aggiunge middleware CSRF, include router admin, applica
  `Depends(get_current_user)` ai router protetti.
- `api/app/security.py` — **eliminato** (sostituito da `app/auth/sessions.py`).
- `api/app/routers/auth.py` — riscritto.
- `api/app/routers/diary.py`, `api/app/routers/foods.py` — scoping per utente + permessi.
- `api/app/services/food_cache.py` — nessun cambio di logica; il router decide se chiamare OFF.
- `api/app/models/{diary,goal,food,meal_template,__init__}.py` — nuove colonne/relazioni.
- `api/app/schemas/food.py` — `off_disabled` su `FoodSearchResponse`.
- `api/app/config.py` — nuovi setting (vedi Task 2).
- `api/tests/test_auth.py` — **eliminato** (sostituito da `test_auth_flow.py`; i test sul rate limit e su
  `_client_ip` vanno portati lì).
- `api/tests/test_diary_router.py`, `test_diary_copy.py`, `test_foods_router.py`, `test_models.py` — usano le
  fixture di `conftest.py` e un utente reale invece di `create_session_cookie`.

### Frontend — nuovi file

- `web/src/auth/AuthContext.tsx` — hook `useMe()`, `useHasPermission()`, `useLogout()`.
- `web/src/auth/AdminGuard.tsx` (+ test).
- `web/src/pages/AccountPage.tsx` (+ test) — cambio password, rigenera recovery codes, logout.
- `web/src/pages/admin/AdminUsersPage.tsx` (+ test).
- `web/src/components/admin/UserFormSheet.tsx` (+ test) — crea/modifica utente.
- `web/src/components/admin/OneTimeSecretDialog.tsx` — mostra password temporanea / recovery codes una volta.
- `web/src/components/auth/TotpSetupStep.tsx`, `TotpCodeStep.tsx`, `RecoveryCodesStep.tsx` (+ test).
- `web/src/api/auth.ts` — funzioni auth; `web/src/api/admin.ts` — hook admin.
- `web/src/lib/permissions.ts` — tipi `Permission`, label.

### Frontend — file modificati

- `web/src/api/client.ts` — header `X-Requested-With`, rimozione `login(key)` e `checkAuth()`.
- `web/src/auth/AuthGuard.tsx` (+ test) — usa `useMe()`.
- `web/src/pages/LoginPage.tsx` (+ test) — state machine multi-step.
- `web/src/App.tsx` — route `/account`, `/admin/users`; `QueryCache` con gestione globale 401.
- `web/src/pages/SettingsPage.tsx` (+ test) — sezione account/admin, rispetto `goals.edit`.
- `web/src/pages/SearchPage.tsx`, `web/src/components/CustomFoodForm.tsx`, `web/src/pages/WeekPage.tsx`
  (+ test) — nascondono funzioni senza permesso.
- `web/vite.config.ts` — pattern runtime cache.

---

## Modello dati

### `users`

| Colonna                 | Tipo                        | Note                                                  |
| ----------------------- | --------------------------- | ----------------------------------------------------- |
| `id`                    | integer PK                  |                                                       |
| `username`              | varchar(32) unique not null | minuscolo, validato                                   |
| `display_name`          | varchar(64) not null        |                                                       |
| `role`                  | enum `user_role` (`admin`,`user`) not null default `user` |                         |
| `permissions`           | JSONB not null default `[]` | lista di `Permission`; ignorata per admin             |
| `password_hash`         | text null                   | null ⇒ login impossibile                              |
| `must_change_password`  | boolean not null default true |                                                     |
| `totp_secret_enc`       | text null                   | Fernet token del segreto confermato                   |
| `totp_pending_secret_enc` | text null                 | segreto in fase di setup, non ancora confermato       |
| `totp_enabled`          | boolean not null default false |                                                    |
| `totp_last_used_step`   | bigint null                 | anti-replay: ultimo time-step accettato               |
| `auth_version`          | integer not null default 1  | +1 a ogni reset password/TOTP; invalida challenge e sessioni |
| `is_active`             | boolean not null default true |                                                     |
| `failed_login_count`    | integer not null default 0  |                                                       |
| `locked_until`          | timestamptz null            |                                                       |
| `last_login_at`         | timestamptz null            |                                                       |
| `created_at`            | timestamptz not null default now() |                                                |
| `updated_at`            | timestamptz not null default now(), onupdate |                                      |

### `user_sessions`

`id` PK, `user_id` FK→users `ON DELETE CASCADE` (index), `token_hash` char(64) unique, `auth_version`
integer (copia al momento della creazione), `created_at`, `last_seen_at`, `expires_at` timestamptz,
`user_agent` varchar(255) null, `ip` varchar(64) null.

Una sessione è valida se: esiste per `sha256(token)`, `expires_at > now`, utente `is_active`, e
`session.auth_version == user.auth_version`.

### `recovery_codes`

`id` PK, `user_id` FK `ON DELETE CASCADE` (index), `code_hash` char(64), `used_at` timestamptz null,
`created_at`.

### `audit_log`

`id` PK, `created_at` timestamptz default now() (index desc), `actor_user_id` FK `ON DELETE SET NULL` null,
`target_user_id` FK `ON DELETE SET NULL` null, `action` varchar(64), `ip` varchar(64) null, `details` JSONB
not null default `{}`. Azioni: `login.success`, `login.failure`, `login.locked`, `totp.setup`,
`totp.recovery_used`, `password.change`, `recovery.regenerate`, `admin.user_create`, `admin.user_update`,
`admin.user_delete`, `admin.password_reset`, `admin.totp_reset`, `admin.sessions_revoke`,
`admin.goal_set`. Mai salvare password, codici o segreti in `details`.

### Tabelle esistenti

- `diary_entries.user_id` integer not null FK→users `ON DELETE CASCADE`. Indice `ix_diary_entries_date`
  sostituito da `ix_diary_entries_user_date (user_id, date)`.
- `goals.user_id` integer not null FK `ON DELETE CASCADE`; indice `(user_id, valid_from)`.
- `meal_templates.user_id` integer not null FK `ON DELETE CASCADE`; index.
- `foods.owner_user_id` integer null FK `ON DELETE SET NULL`; index. Check constraint
  `ck_foods_owner_only_custom`: `source = 'custom' OR owner_user_id IS NULL`.

---

## API

### Pubbliche (senza sessione)

| Metodo | Path                         | Body → Risposta |
| ------ | ---------------------------- | --------------- |
| GET    | `/api/health`                | invariato |
| POST   | `/api/auth/login`            | `{username, password}` → `{status: "totp_required"}` oppure `{status: "setup_required", must_change_password: bool}`; setta `login_challenge` |
| POST   | `/api/auth/totp`             | challenge `stage=totp`; `{code}` oppure `{recovery_code}` → `{status: "ok"}`; setta `session`, cancella challenge |
| POST   | `/api/auth/setup/start`      | challenge `stage=setup` → `{otpauth_uri, secret, qr_svg_data_uri}`; genera e salva `totp_pending_secret_enc` (rigenera a ogni chiamata) |
| POST   | `/api/auth/setup/complete`   | challenge `stage=setup`; `{code, new_password?}` → `{status: "ok", recovery_codes: [10 stringhe]}`; `new_password` obbligatoria se `must_change_password`; setta `session` |

### Autenticate

| Metodo | Path                               | Note |
| ------ | ---------------------------------- | ---- |
| GET    | `/api/auth/me`                     | `{id, username, display_name, role, permissions: [effettivi]}` |
| POST   | `/api/auth/logout`                 | cancella la sessione corrente, 204, cookie azzerato |
| POST   | `/api/auth/password`               | `{current_password, new_password}`; revoca **le altre** sessioni; `auth_version` NON cambia (la sessione corrente resta valida — le altre vanno cancellate esplicitamente) |
| POST   | `/api/auth/recovery-codes`         | `{code}` (TOTP attuale) → `{recovery_codes}`; invalida i precedenti |
| GET    | `/api/auth/sessions`               | sessioni proprie `{id, created_at, last_seen_at, user_agent, ip, current}` |
| DELETE | `/api/auth/sessions/{id}`          | revoca una propria sessione (404 se non propria) |
| *      | `/api/foods/*`, `/api/diary/*`, `/api/goals` | come oggi, scoped per utente, con permessi |

### Admin (`require_admin`, altrimenti 403)

| Metodo | Path                                         | Note |
| ------ | -------------------------------------------- | ---- |
| GET    | `/api/admin/permissions`                     | `[{key, label, default}]` |
| GET    | `/api/admin/users`                           | lista `AdminUserOut`: `id, username, display_name, role, permissions, is_active, totp_enabled, must_change_password, locked_until, last_login_at, created_at, active_sessions` |
| POST   | `/api/admin/users`                           | `{username, display_name, role, permissions?}` → `{user: AdminUserOut, temporary_password}` (201). `permissions` omesso ⇒ default. 409 se username esiste |
| GET    | `/api/admin/users/{id}`                      | dettaglio |
| PATCH  | `/api/admin/users/{id}`                      | `{username?, display_name?, role?, permissions?, is_active?}`. Disattivazione ⇒ revoca sessioni. Guardie punto 19 |
| POST   | `/api/admin/users/{id}/reset-password`       | → `{temporary_password}`; `must_change_password=true`, `auth_version+1`, revoca sessioni |
| POST   | `/api/admin/users/{id}/reset-totp`           | azzera TOTP e recovery codes, `auth_version+1`, revoca sessioni. Permesso anche su se stessi (logout immediato) |
| POST   | `/api/admin/users/{id}/unlock`               | azzera `failed_login_count`, `locked_until` |
| POST   | `/api/admin/users/{id}/revoke-sessions`      | 204 |
| DELETE | `/api/admin/users/{id}`                      | body `{confirm_username}` deve coincidere; 204. Guardie punto 19 |
| GET    | `/api/admin/users/{id}/goal`                 | obiettivo attivo dell'utente (404 se nessuno) |
| PUT    | `/api/admin/users/{id}/goal`                 | come `PUT /api/goals` ma per l'utente target |
| GET    | `/api/admin/audit?limit=200`                 | eventi più recenti, con `actor_username`, `target_username` |

Errori: 404 utente inesistente; 409 username duplicato o guardia admin violata (`detail` esplicativo in
italiano); 422 validazione.

---

## Task 0 — Preparazione

- [ ] Verifica di essere su `feature/multi-user` (`git branch --show-current`).
- [ ] Da `api/`: `pip install -e ".[dev]"`, `pytest` e `ruff check .` verdi **prima** di iniziare. Da `web/`:
  `npm install`, `npm test`, `npm run build` verdi. Se qualcosa è già rosso, annotalo in *Deviazioni*.

## Task 1 — Dipendenze e configurazione

- [ ] Aggiungi a `api/pyproject.toml` le 4 dipendenze dei *Vincoli globali*; reinstalla.
- [ ] `api/app/config.py`: aggiungi
  - `session_max_age_days: int = 30`
  - `login_challenge_max_age_seconds: int = 300`
  - `totp_issuer: str = "YourFitnessPal"`
  - `user_lockout_threshold: int = 10`, `user_lockout_minutes: int = 15`
  - aggiorna il commento di `app_key`: segreto server, non più password; cambiarlo invalida sessioni di
    challenge e **tutti i TOTP**.
- [ ] `.env.example`: aggiorna il commento di `APP_KEY` di conseguenza.
- [ ] Commit `build(api): add argon2, pyotp, segno, cryptography`.

## Task 2 — Modelli e migration

- [ ] Crea `api/app/models/user.py` con `Role` (`str, enum.Enum`, valori `admin`/`user`, stesso pattern
  `values_callable` di `Meal`), `User`, `UserSession`, `RecoveryCode`, `AuditEvent` come da *Modello dati*.
- [ ] Aggiungi `user_id` a `DiaryEntry`, `Goal`, `MealTemplate`; `owner_user_id` a `Food` con il check
  constraint. Aggiorna i docstring (in particolare `Goal`, che oggi dice "single-user app ... no user_id").
- [ ] Esporta i nuovi modelli in `app/models/__init__.py`.
- [ ] Migration a mano `api/alembic/versions/<rev>_multi_user.py` (`down_revision = "162b1885de07"`).
  `upgrade()`, in quest'ordine, in un'unica transazione:
  1. crea enum `user_role` e tabelle `users`, `user_sessions`, `recovery_codes`, `audit_log`;
  2. `INSERT INTO users (username, display_name, role, permissions, password_hash, must_change_password)
     VALUES ('admin', 'Admin', 'admin', '[]', NULL, true) RETURNING id` → `admin_id`;
  3. aggiungi `user_id` **nullable** a `diary_entries`, `goals`, `meal_templates` e `owner_user_id` a
     `foods`;
  4. `UPDATE diary_entries SET user_id = :admin_id` (idem `goals`, `meal_templates`);
     `UPDATE foods SET owner_user_id = :admin_id WHERE source = 'custom'`;
  5. `ALTER COLUMN user_id SET NOT NULL` sulle tre tabelle; crea FK, indici, check constraint;
  6. drop `ix_diary_entries_date`, crea `ix_diary_entries_user_date`.
  `downgrade()`: elimina le righe di `diary_entries`/`goals`/`meal_templates` con `user_id <> admin_id`
  (admin = utente `role='admin'` con `id` minimo), elimina gli alimenti custom di altri utenti non
  referenziati, poi drop colonne/indici/tabelle/enum e ricrea `ix_diary_entries_date`. Commento in testa:
  il downgrade **perde i dati degli utenti non admin**.
- [ ] `api/tests/test_models.py`: aggiorna i test esistenti (ora serve un `User` per creare entry/goal).
  Aggiungi test: unicità username, check constraint `owner_user_id` su food non custom, cascade delete utente
  su entry/goal/sessioni.
- [ ] Test migration manuale (documenta l'esito nel messaggio di commit o in *Deviazioni*): su un DB con la
  vecchia revision e dati finti, `alembic upgrade head` ⇒ tutte le righe con `user_id` dell'admin; poi
  `alembic downgrade -1` e di nuovo `upgrade head` senza errori.
- [ ] Commit `feat(api): users, sessions, recovery codes, audit log; scope data by user`.

## Task 3 — Primitive di sicurezza (unit test, niente DB)

- [ ] `app/auth/passwords.py`:
  - `hash_password(pw) -> str`, `verify_password(hash, pw) -> bool` (cattura `VerifyMismatchError`,
    `InvalidHashError`), `needs_rehash(hash) -> bool`;
  - `verify_dummy(pw)`: verifica contro un hash precalcolato a import time (tempi uniformi);
  - `validate_password_policy(pw)` → `ValueError` con messaggio italiano se fuori 12–128;
  - `generate_temp_password()` → 16 caratteri da alfabeto senza ambigui (`secrets.choice`).
- [ ] `app/auth/totp.py`:
  - `new_secret()` (`pyotp.random_base32()`), `encrypt_secret(s)`, `decrypt_secret(token)` (Fernet con
    chiave HKDF da `settings.app_key`);
  - `provisioning_uri(secret, username)` con issuer da settings;
  - `qr_svg_data_uri(uri)` via `segno.make(uri, error="m").svg_data_uri(scale=6)`;
  - `verify_code(secret, code, last_used_step) -> int | None`: normalizza (strip spazi), accetta solo 6
    cifre, prova gli step `now-1, now, now+1`, rifiuta step `<= last_used_step`, restituisce lo step
    accettato (il chiamante lo salva in `totp_last_used_step`).
- [ ] `app/auth/recovery.py`: `generate_codes(n=10)` → formato `xxxxx-xxxxx` (base32 minuscolo senza
  padding); `hash_code(code)` normalizza (minuscolo, senza trattini/spazi) e fa SHA-256 hex.
- [ ] `tests/test_totp.py` e `tests/test_passwords.py`: roundtrip cifratura; codice valido accettato;
  codice dello stesso step rifiutato al secondo uso (replay); step ±1 accettati, ±2 rifiutati (usa
  `pyotp.TOTP(secret).at(ts)` e patch del tempo); input non numerico rifiutato; policy password;
  `generate_temp_password` rispetta la policy; hash recovery insensibile a maiuscole e trattini.
- [ ] Commit `feat(api): password hashing, TOTP and recovery code primitives`.

## Task 4 — Sessioni, challenge, dependency di autenticazione

- [ ] `app/auth/sessions.py`:
  - `create_session(db, user, request) -> str` (token in chiaro, da mettere nel cookie);
  - `resolve_session(db, token) -> tuple[UserSession, User] | None` (applica tutte le regole di validità;
    se `last_seen_at` più vecchio di 5 min aggiorna `last_seen_at` ed estende `expires_at`);
  - `revoke_session(db, session_id)`, `revoke_all(db, user_id, except_session_id=None)`;
  - `set_session_cookie(response, token)` / `clear_session_cookie(response)` (stessi flag di oggi:
    `HttpOnly`, `Secure` da `settings.cookie_secure`, `SameSite=Lax`, `max_age` da settings, `path="/"`);
  - `sign_challenge(user, stage)` / `read_challenge(request) -> dict | None` e set/clear del cookie
    `login_challenge` (flag punto 13).
- [ ] `app/auth/deps.py`:
  - `get_current_user(request, db=Depends(get_session)) -> User`: legge cookie `session`, `resolve_session`,
    salva `request.state.user_session`; 401 `{"detail": "unauthorized"}` se invalido;
  - `require_admin(user=Depends(get_current_user))` → 403 `{"detail": "forbidden"}` se non admin;
  - `require_permission(p: Permission)` → factory di dependency, 403 se manca.
- [ ] `app/permissions.py`: enum `Permission` (i 4 valori), `PERMISSION_LABELS` (italiano),
  `DEFAULT_PERMISSIONS`, `effective_permissions(user) -> set[Permission]` (tutti se admin; per user
  intersezione tra `user.permissions` e l'enum, ignorando valori sconosciuti).
- [ ] `app/main.py`:
  - elimina `require_session_cookie` e `_PUBLIC_PATHS`; elimina `app/security.py`;
  - router protetti inclusi con `dependencies=[Depends(get_current_user)]` (foods, diary, goals) e
    `dependencies=[Depends(require_admin)]` (admin). Router auth senza dependency globale: ogni endpoint
    autenticato la dichiara singolarmente;
  - `/api/health/protected` resta, con `Depends(get_current_user)`;
  - docs OpenAPI: oggi `/docs` è protetto dal middleware che viene rimosso. Crea
    `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)` e aggiungi route `/api/docs` e
    `/api/openapi.json` con `Depends(require_admin)` (usa `get_swagger_ui_html` e `app.openapi()`).
    Aggiorna la sezione README relativa;
  - middleware CSRF (punto 14): se `request.method` non in `GET/HEAD/OPTIONS` e path inizia con `/api/`,
    richiede `X-Requested-With: yfp`, altrimenti 403 `{"detail": "csrf"}`.
- [ ] `tests/conftest.py`: sposta qui la fixture `session` (transazione con rollback + override
  `get_session`) oggi duplicata in 3 file; aggiungi:
  - `make_user(session, *, username="alice", role=Role.user, permissions=None, password="password-lunga-1",
    totp=True)` → crea utente con password e TOTP confermato, restituisce `(user, totp_secret)`;
  - `authed_client(session, user)` → `AsyncClient` (`base_url="https://test"`, header
    `X-Requested-With: yfp` di default) con cookie di una sessione creata via `create_session`;
  - fixture autouse che azzera il rate limiter in memoria.
- [ ] `tests/test_route_protection.py`: itera `app.routes`; per ogni `APIRoute` il cui path non è in
  `{"/api/health", "/api/auth/login", "/api/auth/totp", "/api/auth/setup/start",
  "/api/auth/setup/complete"}`, verifica che una richiesta senza cookie risponda 401 (usa metodo e path con
  parametri fittizi, header CSRF presente). Questo test deve fallire se in futuro qualcuno aggiunge una
  route senza protezione.
- [ ] `tests/test_sessions.py`: sessione scaduta ⇒ 401; utente disattivato ⇒ 401; `auth_version` cambiato ⇒
  401; token manomesso ⇒ 401; `last_seen_at` aggiornato solo dopo 5 minuti (patch del tempo); richiesta POST
  senza header CSRF ⇒ 403.
- [ ] Commit `feat(api): server-side sessions and auth dependencies`.

## Task 5 — Flusso di login (`routers/auth.py`)

- [ ] Sposta `_client_ip`, `_is_rate_limited`, `_record_attempt` in `app/auth/rate_limit.py` (stesso
  comportamento e docstring). Aggiungi `check_user_lock(user)` / `register_failure(db, user)` /
  `reset_failures(user)` (punto 15).
- [ ] `POST /login`: rate limit IP → cerca utente per username normalizzato (`strip().lower()`) → se assente,
  `verify_dummy` + 401 → se `locked_until > now` 429 → se `not is_active` o `password_hash is None` o
  password errata: `register_failure`, audit `login.failure`, 401 → `needs_rehash` ⇒ aggiorna hash → stage
  = `"totp"` se `totp_enabled` altrimenti `"setup"` → set cookie challenge → risposta.
  **Non** azzerare `failed_login_count` qui: si azzera solo a sessione creata.
- [ ] `POST /totp`: challenge valido con stage `totp` e `av` uguale (altrimenti 401 `challenge scaduto`) →
  rate limit IP → lock check → `code`: `verify_code`; `recovery_code`: cerca hash non usato dell'utente, marca
  `used_at`, audit `totp.recovery_used` → fallimento: `register_failure`, 401 `codice non valido` → successo:
  salva `totp_last_used_step`, `reset_failures`, `last_login_at`, crea sessione, audit `login.success`,
  cancella challenge, set cookie sessione. Esattamente uno tra `code` e `recovery_code` (422 altrimenti).
- [ ] `POST /setup/start`: challenge stage `setup` → nuovo segreto in `totp_pending_secret_enc` → risposta.
- [ ] `POST /setup/complete`: challenge stage `setup` → rate limit → se `must_change_password` richiede
  `new_password` valida (policy) e diversa dalla password corrente → verifica `code` contro il **pending
  secret** (`last_used_step=None`) → sposta pending in `totp_secret_enc`, `totp_enabled=true`, salva step,
  eventuale nuova password con `must_change_password=false`, genera 10 recovery codes (sostituisce
  eventuali vecchi), `reset_failures`, sessione, audit `totp.setup` (+ `password.change` se cambiata) →
  `{status, recovery_codes}`.
- [ ] `GET /me`, `POST /logout`, `POST /password`, `POST /recovery-codes`, `GET /sessions`,
  `DELETE /sessions/{id}` come da tabella API.
- [ ] Schemi Pydantic in `app/schemas/auth.py` (`LoginRequest`, `LoginResponse`, `TotpRequest`,
  `SetupStartResponse`, `SetupCompleteRequest`, `SetupCompleteResponse`, `MeOut`, `PasswordChangeRequest`,
  `RecoveryCodesResponse`, `SessionOut`).
- [ ] `tests/test_auth_flow.py` (DB): porta qui i test di rate limit e `_client_ip` del vecchio
  `test_auth.py`, poi copri:
  - login ok ⇒ `totp_required`, nessun cookie `session`, cookie `login_challenge` presente;
  - username inesistente / password errata / utente disattivato / `password_hash` null ⇒ stesso 401 e
    stesso body;
  - `/totp` senza challenge ⇒ 401; challenge scaduto (patch tempo) ⇒ 401; challenge di stage `setup` usato su
    `/totp` ⇒ 401; `auth_version` cambiato dopo il login ⇒ 401;
  - `/totp` codice corretto ⇒ cookie `session` con flag `HttpOnly`, `Secure`, `SameSite=Lax`; `/me` ⇒ 200;
  - replay dello stesso codice su un secondo login ⇒ 401;
  - recovery code valido ⇒ ok; stesso recovery code riusato ⇒ 401;
  - 10 fallimenti ⇒ `locked_until` impostato, 11° tentativo con credenziali corrette ⇒ 429;
  - utente nuovo (`must_change_password`, no TOTP): login ⇒ `setup_required`; `/setup/complete` senza
    `new_password` ⇒ 422; con password troppo corta ⇒ 422; con codice sbagliato ⇒ 401; flusso completo ⇒ 10
    recovery codes, `/me` ok, secondo login ⇒ `totp_required`;
  - `/setup/start` chiamato due volte ⇒ vale solo l'ultimo segreto;
  - logout ⇒ sessione cancellata in DB, `/me` ⇒ 401;
  - `/password`: password corrente errata ⇒ 401; ok ⇒ altre sessioni revocate, corrente valida;
  - `/sessions/{id}` di un altro utente ⇒ 404;
  - audit: `login.success` e `login.failure` registrati, senza segreti nei `details`.
- [ ] Commit `feat(api): username/password + TOTP login flow`.

## Task 6 — CLI di amministrazione

- [ ] `app/cli.py` con `argparse` (nessuna dipendenza nuova), eseguibile come `python -m app.cli`:
  - `set-password <username>`: chiede la password due volte con `getpass`, applica la policy, imposta
    `must_change_password=false`, `auth_version+1`, revoca sessioni. Opzione `--temporary` ⇒ genera e stampa
    una password temporanea con `must_change_password=true`;
  - `reset-totp <username>`: azzera TOTP, recovery codes, `auth_version+1`, revoca sessioni, sblocca;
  - `create-admin <username> [--display-name]`: crea admin con password temporanea stampata (per
    installazioni nuove o recupero);
  - `list-users`: tabella `id username role active totp`.
  Ogni comando scrive un evento audit con `actor_user_id=NULL` e `details={"source": "cli"}`.
- [ ] `tests/test_cli.py`: testa le funzioni async sottostanti (non il parsing `getpass`), con la fixture
  `session`.
- [ ] Commit `feat(api): admin CLI for password and TOTP recovery`.

## Task 7 — Scoping dati per utente (diario, obiettivi, alimenti)

Obiettivo: nessuna query su `diary_entries`, `goals`, `meal_templates` senza filtro `user_id`; nessun
alimento custom altrui visibile o utilizzabile.

- [ ] `routers/diary.py`: ogni endpoint riceve `user: User = Depends(get_current_user)`.
  - `_active_goal(session, user_id, for_date)`;
  - `get_day`, `get_week`: `where(DiaryEntry.user_id == user.id, ...)`;
  - `create_entry`: la food deve essere visibile (`_visible_food(session, user, food_id)` in un helper
    condiviso con foods: `source != 'custom' OR owner_user_id == user.id`), altrimenti 404
    `food not found`; `user_id=user.id`; il calcolo `max(position)` filtra anche per `user_id`;
  - `patch_entry`, `delete_entry`: carica con `where(id == entry_id, user_id == user.id)`; non trovato ⇒
    404; `max(position)` filtrato per utente;
  - `copy_days`: `Depends(require_permission(Permission.diary_copy))`; select, delete e `max(position)`
    tutti filtrati per `user_id`; insert con `user_id`;
  - `get_goal`: filtro utente; `put_goal`: `require_permission(Permission.goals_edit)`, `user_id=user.id`.
- [ ] `routers/foods.py`:
  - `search_foods`: filtro visibilità sui risultati locali; subquery `usage_count` filtrata per
    `DiaryEntry.user_id == user.id` (il ranking è personale); fallback OFF solo se l'utente ha
    `foods.off_lookup`, altrimenti `off_disabled=True` e nessuna chiamata a `off_client`;
  - `recent_foods`: subquery filtrata per utente + filtro visibilità;
  - `get_food_by_barcode`: senza `foods.off_lookup` usa solo la riga in cache (`select ... where barcode`),
    404 se assente; con permesso comportamento attuale. (Gli alimenti con barcode sono sempre OFF, quindi
    condivisi.)
  - `create_custom_food`: `require_permission(Permission.foods_custom_create)`, `owner_user_id=user.id`.
- [ ] `schemas/food.py`: `off_disabled: bool = False` su `FoodSearchResponse`, con commento.
- [ ] Aggiorna `tests/test_diary_router.py`, `test_diary_copy.py`, `test_foods_router.py` per usare
  `conftest.py` (`make_user` + `authed_client`) al posto di `create_session_cookie`. I test esistenti
  devono continuare a passare con un solo utente.
- [ ] `tests/test_isolation.py` — due utenti `alice` e `bob`, ciascuno con dati propri:
  - `GET /diary/day/{d}` di bob non contiene entry di alice, e totali/obiettivo sono quelli di bob;
  - `GET /diary/week` idem;
  - `PATCH` e `DELETE` di una entry di alice fatti da bob ⇒ 404 e la entry resta invariata;
  - `POST /diary/copy` di bob non copia né cancella (modalità `replace`) entry di alice sulle stesse date;
  - posizioni: entry di alice non influenzano `position` delle entry di bob nello stesso giorno/pasto;
  - `GET /goals` di bob ⇒ 404 se bob non ha obiettivi anche se alice li ha;
  - alimento custom di alice: assente in `search` e `recent` di bob; `POST /diary/entries` di bob con quel
    `food_id` ⇒ 404;
  - alimento OFF usato da alice: visibile a bob in `search`, ma non in `recent` di bob;
  - ranking `search`: l'uso di alice non cambia l'ordine per bob.
- [ ] `tests/test_permissions.py`: utente senza `diary.copy` ⇒ 403 su copy; senza `goals.edit` ⇒ 403 su
  `PUT /goals` ma 200/404 su `GET`; senza `foods.custom_create` ⇒ 403; senza `foods.off_lookup` ⇒ search con
  `off_disabled: true` e `off_client` mock mai chiamato, barcode non in cache ⇒ 404 senza chiamata OFF;
  admin con `permissions=[]` ⇒ tutto consentito.
- [ ] Commit `feat(api): scope diary, goals and custom foods per user; enforce permissions`.

## Task 8 — Router admin

- [ ] `app/schemas/admin.py`: `PermissionOut`, `AdminUserOut`, `AdminUserCreate`, `AdminUserCreateResponse`,
  `AdminUserPatch`, `TemporaryPasswordResponse`, `AdminDeleteRequest`, `AuditEventOut`. Validatori:
  username (punto 17), `permissions` ⊆ enum (422 altrimenti), `display_name` 1–64.
- [ ] `app/routers/admin.py` con tutti gli endpoint della tabella *Admin*. Regole:
  - guardia "ultimo admin attivo": prima di ogni PATCH che toglie `role=admin` o `is_active`, e prima di
    DELETE, conta gli admin attivi escluso il target; se 0 ⇒ 409 `deve esistere almeno un amministratore
    attivo`;
  - self-guard: il target è l'utente corrente e l'operazione è disattivazione, cambio ruolo o delete ⇒ 409
    `non puoi modificare il tuo ruolo o disattivare/eliminare te stesso`;
  - salvataggio `permissions` normalizzato (ordinato, senza duplicati); per `role=admin` salvare `[]`;
  - `active_sessions` = count sessioni non scadute;
  - ogni azione ⇒ `audit.record(...)`; per `admin.user_update` salvare in `details` solo i nomi dei campi
    cambiati e i nuovi valori non sensibili (ruolo, permessi, is_active);
  - `PUT /users/{id}/goal` riusa la logica di `put_goal` (estrai una funzione `create_goal(session, user_id,
    payload)` in `services/diary.py` o nel router diary).
- [ ] `tests/test_admin_router.py`:
  - utente normale ⇒ 403 su tutti gli endpoint admin (parametrizzato); senza sessione ⇒ 401;
  - create ⇒ 201, `temporary_password` rispetta la policy, utente con `must_change_password` e senza TOTP,
    permessi di default; username duplicato (anche con maiuscole diverse) ⇒ 409; permesso sconosciuto ⇒ 422;
  - l'utente creato completa il flusso setup con la password temporanea (test end-to-end);
  - PATCH ruolo/permessi/is_active; disattivazione ⇒ sessioni del target revocate;
  - self-demote, self-disable, self-delete ⇒ 409; degradare l'unico altro admin quando l'attuale è l'unico
    ⇒ consentito solo se resta ≥1 admin attivo;
  - reset-password ⇒ vecchia password rifiutata, sessioni revocate, `auth_version` incrementato;
  - reset-totp ⇒ login successivo ⇒ `setup_required`; recovery codes cancellati;
  - unlock ⇒ `locked_until` null;
  - delete con `confirm_username` sbagliato ⇒ 422; corretto ⇒ entry/goal/sessioni cancellate, alimenti
    custom con `owner_user_id` null e invisibili;
  - admin goal: `PUT /admin/users/{id}/goal` ⇒ visibile a quell'utente in `GET /goals`;
  - audit: ogni azione crea un evento; `GET /admin/audit` ordinato per `created_at desc`.
- [ ] Commit `feat(api): admin user management endpoints`.

## Task 9 — Frontend: client API e contesto utente

- [ ] `web/src/api/client.ts`: aggiungi `"X-Requested-With": "yfp"` a ogni richiesta; rimuovi `login(key)`,
  `LoginResponse` e `checkAuth()` (e il loro uso). Mantieni `ApiError`.
- [ ] `web/src/api/auth.ts`: tipi e funzioni `login(username, password)`, `verifyTotp({code}|{recovery_code})`,
  `setupStart()`, `setupComplete({code, new_password?})`, `logout()`, `getMe()`, `changePassword()`,
  `regenerateRecoveryCodes(code)`, `listSessions()`, `revokeSession(id)`.
- [ ] `web/src/lib/permissions.ts`: `type Permission = "foods.off_lookup" | "foods.custom_create" |
  "diary.copy" | "goals.edit"`.
- [ ] `web/src/auth/AuthContext.tsx`:
  - `useMe()`: `useQuery({queryKey: ["me"], queryFn: getMe, retry: false, staleTime: 5 * 60_000})`;
  - `useHasPermission(p)`: `true` se `role === "admin"` o `permissions.includes(p)`;
  - `useIsAdmin()`;
  - `useLogout()`: chiama `logout()`, poi `clearClientCaches(queryClient)` e `navigate("/login", {replace:
    true})`;
  - `clearClientCaches(queryClient)` esportata: `queryClient.clear()` e, se `"caches" in window`,
    `caches.delete("api-foods-cache")` (errori ignorati).
- [ ] `web/src/App.tsx`: `QueryClient` con `queryCache: new QueryCache({ onError })` e
  `mutationCache: new MutationCache({ onError })`: su `ApiError` 401 per query diverse da `["me"]` ⇒
  `queryClient.setQueryData(["me"], null)` e `queryClient.invalidateQueries({queryKey: ["me"]})` così
  `AuthGuard` reindirizza. Aggiungi route `/account` (dentro `AppShell`) e `/admin/users` (dentro
  `AdminGuard` e `AppShell`).
- [ ] `web/src/auth/AuthGuard.tsx`: usa `useMe()`; loading ⇒ schermata "Loading..." attuale; errore 401 ⇒
  `<Navigate to="/login" replace />`; errore di rete ⇒ messaggio "Impossibile contattare il server" con
  pulsante Riprova (oggi un errore di rete manda al login: comportamento da correggere).
- [ ] `web/src/auth/AdminGuard.tsx`: se non admin ⇒ `<Navigate to="/" replace />`.
- [ ] `web/vite.config.ts`: `urlPattern` limitato a `/api/foods/search` e `/api/foods/barcode/`, con
  commento sul perché (`/recent` è per utente; al logout la cache viene comunque cancellata).
- [ ] Test: `AuthGuard.test.tsx` (autenticato, 401, errore di rete), `AdminGuard.test.tsx`,
  test per `useHasPermission` e `clearClientCaches` (mock di `caches`), `queries.test.tsx` aggiornato se
  dipendeva da `client.ts` rimosso.
- [ ] Commit `feat(web): session-aware auth context and guards`.

## Task 10 — Frontend: login multi-step

- [ ] `LoginPage.tsx` come state machine con `type Step = "credentials" | "totp" | "setup" | "recovery"`:
  - **credentials:** campi `Username` (`autoComplete="username"`, `autoCapitalize="none"`) e `Password`
    (`autoComplete="current-password"`). Risposta `totp_required` ⇒ step `totp`; `setup_required` ⇒ step
    `setup` con `mustChangePassword`.
  - **totp** (`TotpCodeStep`): input 6 cifre (`inputMode="numeric"`, `autoComplete="one-time-code"`,
    `pattern="[0-9]{6}"`), link "Usa un codice di recupero" che cambia input; su 401 `challenge scaduto`
    torna a `credentials` con messaggio "Sessione di accesso scaduta, reinserisci le credenziali".
    Successo ⇒ `clearClientCaches` + `navigate("/")`.
  - **setup** (`TotpSetupStep`): se `mustChangePassword`, campi "Nuova password" e "Conferma password"
    (validazione client 12–128 e uguaglianza); chiama `setupStart()` al mount e mostra QR (`<img
    src={qr_svg_data_uri} alt="QR code per l'app di autenticazione">`), segreto testuale raggruppato a 4
    caratteri con pulsante "Copia", link `otpauth://` "Apri nell'app" (utile da iPhone), istruzioni brevi;
    input codice; submit ⇒ `setupComplete`.
  - **recovery** (`RecoveryCodesStep`): lista dei 10 codici in monospace, pulsante "Copia tutti", checkbox
    obbligatoria "Ho salvato i codici in un posto sicuro" per abilitare "Continua" ⇒ `clearClientCaches` +
    `navigate("/")`.
  - Errori mostrati con il box `role="alert"` già usato. 429 ⇒ messaggio dal `detail`.
  - Rimuovi il testo "Inserisci la chiave di accesso".
- [ ] Test (`LoginPage.test.tsx` riscritto + test dei 3 step): credenziali ⇒ totp ⇒ home; credenziali ⇒
  setup con cambio password (password non coincidenti bloccano il submit) ⇒ recovery (Continua disabilitato
  finché la checkbox non è spuntata) ⇒ home; codice di recupero; challenge scaduto torna alle credenziali;
  errore 401 credenziali mostra `credenziali non valide`.
- [ ] Commit `feat(web): multi-step login with TOTP setup and recovery codes`.

## Task 11 — Frontend: account e permessi nella UI

- [ ] `AccountPage.tsx` (`/account`), header "Account":
  - card profilo: display name, username, badge ruolo;
  - "Cambia password": password attuale, nuova, conferma ⇒ `changePassword`; messaggio "Password aggiornata.
    Le altre sessioni sono state disconnesse.";
  - "Codici di recupero": pulsante "Rigenera" ⇒ chiede codice TOTP ⇒ mostra i codici con
    `OneTimeSecretDialog`;
  - "Sessioni attive": lista con dispositivo (user agent abbreviato), ultimo accesso, badge "Questa
    sessione", pulsante "Disconnetti" sulle altre;
  - pulsante "Esci" (`useLogout`).
- [ ] `SettingsPage.tsx`: in cima una card "Account" con nome utente e link a `/account`; se admin, riga
  "Gestione utenti" con link a `/admin/users`. Se l'utente non ha `goals.edit`: campi obiettivo in sola
  lettura, pulsante nascosto, nota "Gli obiettivi sono gestiti dall'amministratore.".
- [ ] `SearchPage.tsx`/`CustomFoodForm.tsx`: senza `foods.custom_create` nascondi l'ingresso "alimento
  personalizzato"; se la risposta ha `off_disabled`, mostra nota discreta "Ricerca limitata agli alimenti già
  presenti" al posto del messaggio di OFF non raggiungibile. Scanner: senza `foods.off_lookup` un 404 mostra
  "Prodotto non presente in archivio".
- [ ] `WeekPage.tsx`: senza `diary.copy` nascondi selezione e azione di copia.
- [ ] Aggiorna `queries.ts`: tipo `FoodSearchResponse` con `off_disabled?: boolean`.
- [ ] Test per ciascun comportamento condizionale (con `me` mockato admin / user con e senza permesso) e per
  `AccountPage`.
- [ ] Commit `feat(web): account page and permission-aware UI`.

## Task 12 — Frontend: pannello gestione utenti

- [ ] `web/src/api/admin.ts`: hook React Query `useAdminUsers`, `useAdminPermissions`, `useCreateUser`,
  `useUpdateUser`, `useResetPassword`, `useResetTotp`, `useUnlockUser`, `useRevokeSessions`,
  `useDeleteUser`, `useAdminUserGoal`, `usePutAdminUserGoal`, `useAuditLog`. Invalidazione di
  `["admin", "users"]` su `onSettled` (stesso pattern di `useDeleteEntry`, nessun optimistic update).
- [ ] `AdminUsersPage.tsx` (`/admin/users`), stile coerente con `SettingsPage` (header `app-header`, card,
  liste con divisori):
  - header "Gestione utenti" con freccia indietro a `/settings` e pulsante "+ Nuovo utente";
  - lista utenti: display name, `@username`, badge `Admin`, `Disattivato`, `Bloccato`, `2FA da configurare`,
    `Cambio password richiesto`; ultimo accesso relativo ("3 giorni fa"); tap ⇒ `UserFormSheet` in
    modifica;
  - sezione "Registro attività" collassabile con gli ultimi eventi (data, attore, azione in italiano,
    target).
- [ ] `UserFormSheet.tsx` (bottom sheet, riusa le classi di `EditEntrySheet`/`QuantityPicker`):
  - **creazione:** username, nome visualizzato, ruolo (segmented `Utente` / `Admin`), checkbox permessi
    (nascoste se ruolo Admin, con nota "Gli amministratori hanno tutti i permessi"), precompilate con i
    default da `/api/admin/permissions`. Successo ⇒ `OneTimeSecretDialog` con la password temporanea,
    pulsante Copia e testo "Comunicala all'utente: non sarà più visibile. Al primo accesso dovrà cambiarla e
    configurare l'autenticazione a due fattori.";
  - **modifica:** stessi campi + toggle "Attivo" + sezione "Obiettivi" (visualizza/imposta obiettivo per
    l'utente) + azioni: "Reimposta password" (conferma ⇒ dialog password temporanea), "Reimposta 2FA"
    (conferma), "Sblocca" (solo se bloccato), "Disconnetti tutte le sessioni" (mostra conteggio), "Elimina
    utente" (dialog che richiede di digitare l'username; testo che avverte della cancellazione definitiva
    del diario);
  - per l'utente corrente: ruolo, toggle attivo ed elimina disabilitati con nota "Non puoi modificare il tuo
    account da qui";
  - errori 409/422 del backend mostrati nel box `role="alert"`.
- [ ] Test: lista con badge corretti; creazione ⇒ dialog con password; permessi nascosti per ruolo Admin;
  modifica permessi invia PATCH corretto; conferma eliminazione abilitata solo con username esatto; controlli
  disabilitati sul proprio account; errore 409 mostrato.
- [ ] Commit `feat(web): admin user management panel`.

## Task 13 — Verifica end-to-end manuale

Esegui con Docker Compose su un DB **copia** dei dati reali (o dati finti), `COOKIE_SECURE=false` in locale:

- [ ] `docker compose up -d --build`, `docker compose exec api alembic upgrade head`.
- [ ] `docker compose exec api python -m app.cli set-password admin`.
- [ ] Login `admin` ⇒ setup TOTP con un'app reale (es. Google Authenticator / 1Password) ⇒ recovery codes ⇒
  il diario esistente è visibile e invariato (confronta i totali di qualche giorno con quelli prima della
  migration).
- [ ] Crea utente `test` senza `diary.copy` ⇒ in un'altra finestra privata completa il primo accesso ⇒
  diario vuoto, niente copia settimana, alimenti custom dell'admin non trovabili.
- [ ] Da admin: disattiva `test` ⇒ la finestra di `test` alla prossima azione torna al login.
- [ ] Logout e login con un altro utente sullo stesso browser ⇒ nessun dato del precedente visibile (anche
  offline nella PWA installata, se possibile).
- [ ] Da iPhone (dev server `--host`): il link `otpauth://` apre l'app authenticator; `autoComplete=
  "one-time-code"` propone il codice.
- [ ] `docker compose exec api python -m app.cli reset-totp admin` ⇒ il login successivo richiede setup.
- [ ] Annota eventuali problemi in *Deviazioni*.

## Task 14 — Documentazione

- [ ] `README.md`:
  - intro: non più "one household sharing a key" ⇒ utenti gestiti dall'amministratore;
  - *Quick start*: dopo la migration, `python -m app.cli set-password admin`, poi primo login con setup
    2FA; `APP_KEY` ora è solo un segreto server;
  - *Authentication model* riscritto: password + TOTP obbligatorio, sessioni lato server 30 giorni sliding,
    recovery codes, lockout, rate limit, CSRF header, ruoli e permessi (tabella), cosa succede cambiando
    `APP_KEY`;
  - nuova sezione *User management* (pannello + CLI, recupero admin bloccato fuori dall'app);
  - tabella *API* aggiornata con endpoint auth e admin; `/docs` ora in `/api/docs`, solo admin;
  - *Deploying updates*: per questa release, `pg_dump` prima della migration (comando esempio:
    `docker compose exec db pg_dump -U postgres yourfitnesspal > backup.sql`), poi migration e CLI;
  - *Exposing it publicly*: Cloudflare Access resta consigliato ma non più l'unica barriera;
  - *Known gaps*: rimuovi "Single-tenant by design"; aggiungi "nessuna impersonazione/vista admin sui diari",
    "audit log senza rotazione".
- [ ] `.env.example` coerente.
- [ ] Commit `docs: multi-user authentication and administration`.

## Task 15 — Chiusura

- [ ] `api/`: `pytest` e `ruff check .` verdi. `web/`: `npm test` e `npm run build` verdi.
- [ ] `grep -rn "create_session_cookie\|checkAuth\|APP_KEY.*password\|app_key)" api web/src README.md`
  non trova usi residui del vecchio modello (a parte la derivazione chiave TOTP / firma challenge).
- [ ] `grep -rn "select(DiaryEntry)\|select(Goal)" api/app` ⇒ ogni occorrenza filtra per `user_id`
  (controllo manuale riga per riga).
- [ ] Rileggi la sezione *Decisioni di design* e verifica punto per punto che sia rispettata.

---

## Checklist di sicurezza (da verificare prima del merge)

- [ ] Nessun endpoint non pubblico senza `get_current_user` (test `test_route_protection.py`).
- [ ] Nessun accesso cross-utente a entry, goal, custom food, sessioni (test `test_isolation.py`).
- [ ] Password, segreti TOTP, recovery codes e token di sessione mai in log, audit, risposte (tranne i
  momenti "mostrati una volta") o nel DB in chiaro.
- [ ] Confronti di hash con `secrets.compare_digest` o lookup per hash indicizzato.
- [ ] Cookie `session`: `HttpOnly`, `Secure` (configurabile), `SameSite=Lax`. Cookie `login_challenge`:
  `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/auth`, 5 minuti.
- [ ] Richieste mutanti senza `X-Requested-With: yfp` ⇒ 403.
- [ ] Login: errori uniformi, tempi uniformi, rate limit IP, lockout utente.
- [ ] TOTP: anti-replay, finestra ±1 step, segreto cifrato.
- [ ] Logout e cambio utente puliscono cache React Query e Workbox.

## Fuori scope

- Registrazione pubblica, invito via email, reset password via email.
- WebAuthn/passkey.
- Impersonazione o visualizzazione dei diari altrui da parte dell'admin.
- Catalogo di alimenti custom condivisi tra utenti.
- API/UI per `meal_template` (esiste solo il modello; qui si aggiunge solo `user_id`).
- Rotazione/esportazione dell'audit log.

## Deviazioni

_(L'agente che implementa annota qui ogni scostamento dal piano, con motivazione.)_
