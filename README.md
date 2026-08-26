# yourfitnesspal

A self-hosted, ad-free food/macro/weight tracker: FastAPI + Postgres backend, React SPA frontend,
served together behind nginx via Docker Compose.

## Stack

- `api/` — FastAPI + SQLAlchemy (async) + Alembic, backed by Postgres. Food lookups go through
  OpenFoodFacts.
- `web/` — React + Vite SPA (installable PWA), served as static files by nginx, which also
  reverse-proxies `/api/*` to the `api` service.
- `db` — Postgres 16, data persisted in the `db_data` named volume.

## Local / production deploy with Docker Compose

1. Copy the env template and fill in real values:

   ```sh
   cp .env.example .env
   ```

   Generate a strong `APP_KEY` (used to sign sessions/cookies) rather than leaving the
   placeholder:

   ```sh
   openssl rand -hex 32
   ```

   Set `OFF_CONTACT_EMAIL` to a real contact address — OpenFoodFacts requires this in their API
   usage policy. Leave `DATABASE_URL` as-is unless you've changed the `db` service's credentials
   in `docker-compose.yml` to match.

2. Build and start everything in the background:

   ```sh
   docker compose up -d --build
   ```

   This starts `db` (Postgres, not published to the host), `api` (FastAPI, not published to the
   host — reachable only from `web` over the compose network), and `web` (nginx serving the built
   SPA and proxying `/api/*` to `api`), publishing **only** `web` on host port `6500`.

3. Apply database migrations (first boot and after any migration-adding deploy):

   ```sh
   docker compose exec api alembic upgrade head
   ```

4. Visit `http://<host>:6500`.

## Exposing it via Cloudflare Tunnel

Only `web` (port `6500` on the host, container port `80`) needs to be reachable — `db` and `api`
are intentionally not published and should stay that way. Point a Cloudflare Tunnel at
`http://localhost:6500` (or `http://<host>:6500` if the tunnel runs on a different machine):

```sh
cloudflared tunnel --url http://localhost:6500
```

or, for a named tunnel, add a matching entry in your `config.yml`'s `ingress` list pointing at
`http://localhost:6500`.

**Recommended:** put this app behind Cloudflare Access (or an equivalent auth layer) in front of
the tunnel — there's no built-in login/multi-tenant auth here, so anyone who reaches the tunnel's
public hostname can use it.

## Deploying updates

This repo is pushed to a Gitea remote configured as `origin`. On the deploy host: pull the latest
commit, then re-run the build/up step (re-running migrations if a new one shipped):

```sh
git pull origin main
docker compose up -d --build
docker compose exec api alembic upgrade head
```

## Environment variables

See `.env.example` for the full list with descriptions (`APP_KEY`, `DATABASE_URL`,
`OFF_CONTACT_EMAIL`).
