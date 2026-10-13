# YourFitnessPal

A self-hosted food, macro and weight tracker — no ads, no paywall, no account harvesting. One
person (or one household sharing a key) logs meals against OpenFoodFacts' product database from a
phone, and the data stays on your own Postgres.

FastAPI + Postgres behind nginx, with a React PWA front end, all wired together by Docker Compose
and published on a single host port.

## What it does

- **Day diary** — log foods into Colazione / Pranzo / Cena / Spuntino, see the day's calories as a
  ring against your goal plus protein/carb/fat bars.
- **Food search** — full-text search against OpenFoodFacts, with every fetched product cached
  locally so repeat lookups don't hit the network. Results are explicitly marked `OFF` or `cache`,
  and an OFF outage says so instead of silently showing an empty list.
- **Barcode scanning** — the native `BarcodeDetector` API where the browser has it, falling back to
  a dynamically-imported ZXing decoder (older Safari/Firefox).
- **Custom foods** — enter a nutrition label by hand for anything OFF doesn't know.
- **Week view** — seven days of totals, coloured against your goal, with bulk copy: select any set
  of days and replay their meals onto another week (append or replace), optionally filtered to a
  subset of meals.
- **Goals** — daily kcal/protein/carbs/fat targets; these drive the ring, the bars, and the week's
  colouring.
- **Gym log (Strong-style)** — exercise catalog from free-exercise-db plus custom exercises, workout
  templates in folders, a live session with previous values, per-exercise rest timer and supersets,
  a summary that can update the template, and workout history.
- **AI connections (MCP)** — users an admin has enabled can connect Claude (or any MCP client
  with OAuth support) to their own diary at `<PUBLIC_BASE_URL>/mcp`, and ask it to search foods,
  log meals, copy days and change goals. Login uses the same password + TOTP; each connection can
  be revoked from Account.
- **Installable PWA** — add to Home Screen for a full-screen, iOS-safe-area-aware app; the shell is
  precached, and food lookups fall back to cache when the network is slow or down.

## Architecture

```
                 ┌───────────────────────── docker compose ─────────────────────────┐
  iPhone /       │                                                                  │
  browser  ──────┼──►  web (nginx :80)  ──/api/*──►  api (FastAPI :8000)  ──►  db    │
           :6500 │      static SPA                        │                (Postgres)│
                 │                                        │                         │
                 └────────────────────────────────────────┼─────────────────────────┘
                                                          ▼
                                              OpenFoodFacts (world.openfoodfacts.org)
```

Only `web` publishes a host port. `api` and `db` are reachable solely over the compose network —
keep it that way: the API trusts anything holding a valid session cookie.

## Repository layout

```
api/                 FastAPI service
  app/config.py      Settings, read from environment / .env
  app/main.py        App factory, session-cookie middleware, /api/health
  app/models/        SQLAlchemy models (food, diary, goal, meal_template)
  app/routers/       auth, foods, diary + goals
  app/services/      OFF client (rate-limited), food cache, diary logic
  app/mcp/           MCP server, OAuth provider and user-scoped tools
  alembic/           Migrations
  tests/             pytest suite
web/                 React + Vite SPA (PWA)
  src/pages/         Day, Search, Week, Settings, Login
  src/components/    AppShell, DaySummary, MealSection, QuantityPicker, Scanner, …
  src/api/           Fetch client + React Query hooks
  src/auth/          AuthGuard — redirects to /login on a 401
  src/lib/date.ts    UTC-safe ISO calendar-date helpers
  nginx.conf         Static serving + /api proxy + cache headers
docker-compose.yml   db + api + web
```

## Quick start

Requires Docker with the Compose plugin.

1. **Configure.** Copy the template and fill in real values:

   ```sh
   cp .env.example .env
   ```

   Generate a strong `APP_KEY` (it is both the login password and the session-signing secret):

   ```sh
   openssl rand -hex 32
   ```

   Set `OFF_CONTACT_EMAIL` to a real address — OpenFoodFacts' API usage policy requires it in the
   User-Agent. Leave `DATABASE_URL` alone unless you changed the `db` credentials in
   `docker-compose.yml`.

2. **Build and start.**

   ```sh
   docker compose up -d --build
   ```

3. **Apply migrations** (first boot, and after any deploy that ships a new one):

   ```sh
   docker compose exec api alembic upgrade head
   ```

4. **Open** `http://<host>:6500` and log in with your `APP_KEY`.

> Over plain HTTP the login will appear to do nothing: the session cookie is `Secure` by default
> and browsers silently drop `Secure` cookies on non-HTTPS origins. For temporary plain-HTTP
> testing set `COOKIE_SECURE=false` in `.env`; put it back before exposing the app.

## Authentication model

There are no user accounts. A single shared secret (`APP_KEY`) is exchanged at
`POST /api/auth/login` for a signed session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` unless
disabled, 30-day lifetime). Every path except `/api/auth/login` and `/api/health` requires it.
Failed logins are rate-limited to 5 per minute per client IP; successful ones don't consume that
budget, so several devices behind one NAT don't lock each other out.

This is enough for a personal instance on a private network or behind an authenticating tunnel.
It is **not** multi-tenant: anyone with the key sees the same diary.

**Native app (Bearer).** The iOS app logs in the same way: password, then TOTP. It declares itself
with the header `X-YFP-Client: native`. For such clients, the response that completes the login
includes a session token, and the app sends it on every call as `Authorization: Bearer <token>`.
It is an ordinary session, so it is revoked the same way as a cookie session: from Account →
Sessioni attive, or by logging out. Browsers keep receiving only the `HttpOnly` cookie.

## Connecting an AI assistant (MCP)

1. Set `PUBLIC_BASE_URL` to the public HTTPS origin (the tunnel hostname) and restart `api`.
2. As admin, open Gestione utenti → Accesso and enable **Connessioni AI (MCP)** for the user.
3. The user copies the URL from Account → Connessioni AI and, in Claude, adds it under
   Settings → Connectors → Add custom connector. Claude opens the app's login + consent page.
4. Tokens die immediately on password change, TOTP reset, deactivation, permission removal or
   revocation from Account / the admin panel.

Gym tools: `search_exercises`, `list_workout_templates`, `get_workout_template`,
`create_workout_template`, `list_workouts` and `get_workout`. The user also needs the
`workouts.use` permission.

Statistics tools: `get_weight_history`, `get_gym_stats` and `get_exercise_progress` return
read-only statistics already calculated by the API. The gym statistics tools require the
`workouts.use` permission.

Housekeeping: `docker compose exec api python -m app.cli purge-oauth` removes expired codes and
tokens (safe to run from cron).

Routes involved (all proxied by nginx to `api`): `/mcp`, `/.well-known/oauth-*`, `/register`,
`/authorize`, `/token`, `/revoke`.

## API

All routes are under `/api` and require the session cookie unless noted.

| Method   | Path                           | Purpose                                                          |
| -------- | ------------------------------ | ---------------------------------------------------------------- |
| `POST`   | `/api/auth/login`              | Exchange `{ "key": … }` for a session cookie. *Public.*          |
| `GET`    | `/api/health`                  | Liveness probe. *Public.*                                        |
| `GET`    | `/api/foods/search?q=`         | Full-text search (OFF + local cache), flags OFF outages.         |
| `GET`    | `/api/foods/recent`            | Recently logged foods.                                           |
| `GET`    | `/api/foods/barcode/{code}`    | Resolve an EAN/UPC, caching the product locally.                 |
| `POST`   | `/api/foods`                   | Create a custom food from a hand-entered nutrition label.        |
| `GET`    | `/api/diary/day/{date}`        | One day: entries per meal, totals, active goal.                  |
| `GET`    | `/api/diary/week?start=`       | Seven days of totals from an ISO start date.                     |
| `GET`    | `/api/diary/range?start=&end=` | Per-day totals for an inclusive range (max 366 days).            |
| `POST`   | `/api/activity`                | Record that the web app was opened today (streak).               |
| `GET`    | `/api/stats/streak`            | Current and best run of consecutive app-open days.               |
| `GET`    | `/api/weights/today`            | Today's weight, if recorded.                                     |
| `PUT`    | `/api/weights/today`            | Save or replace today's weight.                                  |
| `GET`    | `/api/weights?start=&end=`       | Daily weights and ISO-week averages for an inclusive period.     |
| `DELETE` | `/api/weights/{weight_id}`      | Delete one of the user's weights.                                |
| `GET`    | `/api/stats/gym/count`          | Count of finished workouts.                                      |
| `GET`    | `/api/stats/gym?start=&end=`    | Workout count, volume, duration and weekly frequency.            |
| `GET`    | `/api/stats/gym/exercises`      | Exercises used in finished workouts.                             |
| `GET`    | `/api/stats/gym/exercises/{exercise_id}?start=&end=` | Exercise progression and all-time personal records. |
| `POST`   | `/api/diary/entries`           | Log `{ date, meal, food_id, grams }`.                            |
| `PATCH`  | `/api/diary/entries/{id}`      | Change a logged entry's quantity and/or move it to another meal. |
| `DELETE` | `/api/diary/entries/{id}`      | Remove a logged entry.                                           |
| `POST`   | `/api/diary/copy`              | Bulk-copy days onto a target start date (append/replace).        |
| `POST`   | `/api/saved-weeks`             | Save a diary week. Requires `diary.copy`.                        |
| `GET`    | `/api/saved-weeks`             | List saved weeks. Requires `diary.copy`.                         |
| `GET`    | `/api/saved-weeks/{id}`        | Get a saved week and its seven days. Requires `diary.copy`.      |
| `PATCH`  | `/api/saved-weeks/{id}`        | Rename a saved week. Requires `diary.copy`. |
| `DELETE` | `/api/saved-weeks/{id}`        | Delete a saved week. Requires `diary.copy`. |
| `POST`   | `/api/saved-weeks/{id}/apply`  | Apply a saved week to the diary. Requires `diary.copy`.          |
| `GET`    | `/api/goals`                   | Currently active goal.                                           |
| `PUT`    | `/api/goals`                   | Set the daily kcal/protein/carbs/fat targets.                    |
| —        | `/api/exercises`               | Search the exercise catalog and manage custom exercises.         |
| —        | `/api/templates`               | Create and manage workout templates.                             |
| —        | `/api/template-folders`        | Organize workout templates in folders.                           |
| —        | `/api/workouts`                | Run live workouts and review workout history.                    |

FastAPI mounts its interactive docs at `/docs`, but the session-cookie middleware guards every path
except the two public ones — so `/docs` answers `401` until you hold a session cookie. In local
development (`uvicorn app.main:app --reload`) the simplest route is to log in through the SPA first,
then open `http://localhost:8000/docs` in the same browser.

### OpenFoodFacts usage

Outbound OFF calls go through one shared client for the process, token-bucket limited to **15
product lookups/min** and **10 searches/min**, identifying itself with `OFF_CONTACT_EMAIL`. Every
product that comes back is written to the local `foods` table, so the same item is never fetched
twice. Nutriments are snapshotted onto each diary entry at log time — editing or re-fetching a food
later never rewrites history.

## Local development

The two halves run independently; the SPA's dev server proxies `/api` to a locally running API.

### API

```sh
cd api
python -m venv .venv && . .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload                     # http://localhost:8000
```

Needs a reachable Postgres in `DATABASE_URL` (simplest: `docker compose up -d db` plus a host port
mapping, or point it at any local instance).

```sh
pytest          # test suite
ruff check .    # lint
```

### Web

```sh
cd web
npm install
npm run dev                 # http://localhost:5173, proxying /api to :8000
npm run dev -- --host       # also serve on the LAN, for testing on a real phone
```

```sh
npm test        # vitest
npm run build   # tsc -b && vite build
```

The dev server registers **no** service worker, which makes it the fastest way to check a UI change
on a phone without fighting PWA caching.

## Deploying updates

On the deploy host:

```sh
git pull origin <deployed-branch>
docker compose up -d --build
docker compose exec api alembic upgrade head   # only if a migration shipped
```

The weight and gym statistics feature adds the `a6c1e4b8d203_body_weights` migration; apply it
with `docker compose exec api alembic upgrade head` after deploying.

For rest-finished push alerts, generate a VAPID key pair from the repository root. The script is
not part of the API image, so pipe it into the running `api` container's Python:

```sh
docker compose exec -T api python - < api/scripts/gen_vapid_keys.py
```

Copy the printed `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` assignments into the deploy host's
`.env`, and set `VAPID_SUBJECT` to a contact URI such as `mailto:you@example.com`. Keep the private
key only in `.env`; do not commit it. If the VAPID values are absent, push alerts remain disabled
and the rest of the application works normally. This feature adds a database migration; apply it
with `docker compose exec api alembic upgrade head` as part of the deploy.

This release includes two migrations: `9a4d2c7e1f03` (schema) and `b81f5e3a6c42` (catalog load).
Run them with the usual `docker compose exec api alembic upgrade head`. The catalog lives in
`api/app/data/exercises.json`; see `api/app/data/README.md` for its source and regeneration details.

Two things that make a deploy *look* like it did nothing:

- **The SPA is baked into the image.** `web/dist` is built during `docker build`, so a `git pull`
  without `--build` keeps serving the previous bundle.
- **The PWA caches its own shell.** Installed iOS clients keep the precached `index.html` until the
  service worker updates — close the app fully from the app switcher and reopen it (twice, if
  needed). Anything that lives in `index.html`, such as the `viewport-fit=cover` meta that makes the
  iPhone safe-area insets non-zero, is invisible until that happens. In Safari, use Reload or clear
  the site's data.

## Exposing it publicly (Cloudflare Tunnel)

Only `web` needs to be reachable; leave `db` and `api` unpublished.

```sh
cloudflared tunnel --url http://localhost:6500
```

For a named tunnel, add an `ingress` entry pointing at `http://localhost:6500`.

**Put an auth layer in front of it.** Cloudflare Access or equivalent: there is no per-user login
here, so anyone who reaches the hostname and knows (or brute-forces past the 5/min limiter) the key
gets the diary.

## iOS app (IPA)

The repository builds an unsigned iOS app, `yourfitnesspal-<tag>.ipa`. It wraps the same web UI in a
Capacitor shell and talks to the public API over HTTPS with a Bearer token. It is installed by hand
with [SideStore](https://sidestore.io) on a personal iPhone and a free Apple account. There is no
App Store or TestFlight build, and no SideStore source JSON in this version.

### Prerequisites

- **Gitea → GitHub push mirror that includes tags.** The release is built by GitHub Actions, so the
  mirror must forward tags, not only branches.
- **GitHub Actions enabled** on the GitHub repository that mirrors this one.
- **Secret `GITEA_TOKEN`** on the GitHub repository (Settings → Secrets and variables → Actions): a
  Gitea access token with write permission on the releases of `septimilleso/yourfitnesspal`. The
  workflow uses it to attach the IPA to the Gitea release.
- **Variable `API_BASE_URL`** on the GitHub repository (same page, Variables tab), set to
  `https://pal.septimilleso.uk/api`. No trailing slash. The workflow fails if it is empty.

### Releasing

1. Choose a tag in the form `vX.Y.Z`, numbers only (for example `v0.1.0`). The workflow rejects any
   other form, because the app version (`CFBundleShortVersionString`) accepts only numbers.
2. Create and push the tag to `origin` (Gitea) only:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

   Never push the tag to GitHub directly: the push mirror is the only path from Gitea to GitHub.
3. Release one tag at a time. GitHub creates no push events for tags when more than three arrive in
   a single push, so a batch can silently skip the workflow.
4. The mirror forwards the tag and GitHub starts the **iOS release** workflow. If it does not start,
   open the **Actions** tab on GitHub, choose **iOS release**, run it with **Run workflow** and enter
   the tag name (for example `v0.1.0`). The run builds the commit of that tag, not the branch it runs
   on. The tag must already be on GitHub through the mirror: otherwise the run fails at checkout and
   creates no tag.

The workflow builds the web bundle with `API_BASE_URL`, runs `npx cap sync ios`, builds an unsigned
Release app and packages it as `Payload/App.app`. It checks that `CFBundleShortVersionString` equals
the tag without the `v`, then publishes the IPA to the GitHub release and to the Gitea release of the
same tag.

### Where to find the IPA

Download `yourfitnesspal-<tag>.ipa` from the Releases page of either:

- the GitHub repository, or
- the Gitea repository `septimilleso/yourfitnesspal`.

### Installing and updating with SideStore

1. Install SideStore on the iPhone and sign in with a free Apple account.
2. Open `yourfitnesspal-<tag>.ipa` with SideStore and install it.
3. Launch the app. It opens on the login screen, which is the same as the web login.

To update, install the new IPA the same way. Things to know about a free account:

- **Signatures expire every 7 days.** SideStore's automatic refresh renews them. If a refresh lapses,
  install the IPA again.
- **App ID limit.** Free accounts allow only a small number of App IDs per week. The IPA uses a
  single App ID and has no extensions, so do not add any.

### Notes on this version

- **No Web Push.** The IPA cannot receive Web Push, because it has no APNs entitlement under a free
  account. The end-of-rest alert is a **local notification** scheduled on the phone, with no server
  push involved.
- **Native haptics** are used when a set is completed and when the rest ends.
- **The UI is inside the IPA.** Server changes reach the app as soon as the API is deployed, but any
  UI change needs a new tag and a new IPA.
- **Offline, read-only.** The app opens without a connection and shows the data it loaded online
  before: today's diary, the week, gym, workout history and stats. When data is offline, an amber
  dot appears in the header of the screens that have data. Tapping it shows when the data was last
  updated: `Offline, dati delle <time>`, or `Offline, dati del <day> alle <time>` for older data.
  The dot disappears when the connection returns.
  - Prefetch: with a connection, when the app opens, returns to the foreground or the connection
    returns, the app downloads in the background, at most once every 15 minutes after the last
    completed round: today's and yesterday's diary, the current week, weight, the 7, 30 and 90 day
    statistics, workout templates (up to 30, with their details), the exercise catalogue, the last
    20 workouts with their details, and up to 10 saved weeks. It never runs without a connection or
    on the web, and it does not download food search results or the active workout.
  - Screens with no data offline show "Non disponibile offline".
  - Data tied to the date has a limit: if the last update was yesterday, offline today's diary and
    the 7, 30 and 90 day statistics (which end today) are not available. Yesterday's diary is.
  - Changes need a connection and are not queued. A live workout session is not available offline.
  - Settings shows a line such as `Dati offline: circa 420 KB, salvati alle 14:05`, with the size and
    time of the offline cache, or `Dati offline: nessuno` when there is no cache.
  - After installing, and after each new IPA, open the app once with a connection before the cache
    is available. A first launch without a connection cannot show data.
  - The cache is cleared on logout or when the session is revoked.

### Local builds and CI

The local build differs from the CI build. Build from `web/`:

```sh
cd web
VITE_API_BASE_URL=https://pal.septimilleso.uk/api npm run build:native
npx cap sync ios
```

- The Capacitor project in `web/ios` was generated with Capacitor 7 and Swift Package Manager
  (`web/ios/App/CapApp-SPM`). Run `npx cap sync ios` to update it. Never run `npx cap add ios` again.
- `npm run build:native` requires `VITE_API_BASE_URL` and fails without it.
- CI runs on a macOS runner and builds without code signing. Signing is done by SideStore on the
  phone.

## Environment variables

| Variable            | Default                                                        | Notes                                                                     |
| ------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `APP_KEY`           | `dev-insecure-key-change-me`                                    | Login password **and** cookie-signing secret. Rotating it logs everyone out. |
| `DATABASE_URL`      | `postgresql+asyncpg://postgres:postgres@db:5432/yourfitnesspal` | Async SQLAlchemy URL; must use the `asyncpg` driver.                       |
| `OFF_CONTACT_EMAIL` | `example@example.com`                                           | Sent to OpenFoodFacts as required by their policy.                        |
| `COOKIE_SECURE`     | `true`                                                          | Set `false` only for temporary plain-HTTP testing.                        |
| `PUBLIC_BASE_URL`   | `http://localhost:6500`                                         | Public HTTPS origin (Cloudflare Tunnel hostname), OAuth issuer and base for the MCP URL users paste into Claude; must match the browser origin exactly. |
| `CORS_ALLOWED_ORIGINS` | `["capacitor://localhost"]` | JSON list of origins allowed to call `/api/` cross-origin (the native app's WebView). CORS applies only to `/api/`; credentials are never allowed cross-origin. |
| `APP_TIMEZONE`      | `Europe/Rome`                                                   | Timezone the MCP tools use to decide what "today" is.                    |
| `OAUTH_ACCESS_TOKEN_MINUTES` | `60`                                                    | Lifetime of MCP access tokens.                                            |
| `OAUTH_REFRESH_TOKEN_DAYS`   | `30`                                                    | Lifetime of MCP refresh tokens.                                           |

## Known gaps

- No favourites: the fastest way back to a food you eat often is `GET /api/foods/recent`.
- `meal_template` exists as a model with no API or UI on top of it. Saved weeks are a separate feature and do not use `meal_template`.
- Weight tracking isn't built; the diary covers food and macros only.
- Single-tenant by design (see *Authentication model*).
