# Deployment

The system runs as three containers behind the reverse proxy that already
sits on the server:

```
browser ──► Cloudflare ──► Caddy ──► nginx (web) ──► api ──► mysql
                      └─ TLS cert, real client IP
```

`docker-compose.yml` is the single definition. The same file is used for
a local run and for the server; only the `.env` beside it differs.

## What lives where

| Path | Purpose |
| --- | --- |
| `server/Dockerfile` | three stages: `build` (compile TS), `seed` (runs the TypeScript seed script), `runtime` (production deps only) |
| `client/Dockerfile` | builds the Vite bundle, serves it from an unprivileged nginx (port 8080) |
| `client/nginx.conf` | serves the bundle, proxies `/api/*` to the API container |
| `docker-compose.yml` | db + api + web + a one-shot `seed` job |
| `deploy/caddy.caddy.template` | the reverse proxy site, `__DOMAIN__` is replaced on install |

## Why the pieces are arranged this way

**The browser talks to one origin.** nginx serves the React bundle and
forwards `/api/*` to the API container. The bundle requests a relative
`/api`, so every request the browser makes is same-origin. No CORS
preflight, and one certificate covers the site.

**Nothing runs as root.** The API image drops to the `node` user, and the
web image is the `nginx-unprivileged` variant, which runs the whole tree as
uid 101. That is the reason its server block listens on 8080: binding a port
below 1024 needs privileges. Compose still publishes 8081 on the host, so
nothing outside the container changes.

**Only loopback ports are published.** The compose file binds the
database, the API and nginx to `127.0.0.1`. The only way in is through
Caddy, which is the point - the API's own port is not reachable from the
internet.

**The client address survives the proxy chain.** Caddy sets
`X-Forwarded-For` from Cloudflare's `CF-Connecting-IP` header, nginx
passes it through unchanged, and the API runs with `TRUST_PROXY=true`.
Without that the API would see one address for every visitor and its
per-IP rate limiter would lock out the whole internet at once.

**The seed is a separate job, not a startup step.** `docker compose run
--rm seed --demo` seeds employees and sample data. It is idempotent for
employees, so re-running it is safe.

## Deploying to the server

```bash
# 1. get the code
git clone https://github.com/sallyfoong/event-registration-system.git
cd event-registration-system

# 2. configuration
cp .env.example .env        # then edit the passwords

# 3. build and start
docker compose up -d --build

# 4. seed the database
docker compose run --rm seed --demo

# 5. check it is alive
curl -fsS http://127.0.0.1:8081/api/health
```

## Installing the reverse proxy site

The server keeps one Caddy file per project in `/etc/caddy/sites.d/`, so
this project never touches another project's configuration.

```bash
sed "s/__DOMAIN__/events.myminisite.work/" \
  deploy/caddy.caddy.template > /etc/caddy/sites.d/event-registration.caddy

caddy validate --config /etc/caddy/root.caddy
systemctl reload caddy
```

Caddy obtains the TLS certificate on its own the first time the hostname
resolves to the server.

## DNS

One `A` record in Cloudflare, pointing at the server:

```
events.myminisite.work   A   124.217.248.28
```

With the orange cloud enabled, Cloudflare terminates the connection and
forwards it to the server. Caddy then gets a certificate for the
hostname through the ACME HTTP challenge, which Cloudflare proxies
through like any other request.

## Updating

```bash
git pull
docker compose up -d --build
```

The database is a named volume, so it survives the rebuild. The API
re-syncs the schema on start.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `502 Bad Gateway` from the site | the web container is not up yet, or the API container is unhealthy - `docker compose ps` and `docker compose logs api` |
| every request is rate limited at once | `TRUST_PROXY` is not set, or the real client address is lost in the proxy chain - check that the Caddy site is installed and the `CF-Connecting-IP` branch is in place |
| the site loads but the API calls fail | the bundle was built with an absolute API URL - it must be built with `VITE_API_BASE_URL=/api`, which the compose file already does |
| certificate errors | the hostname does not resolve to this server yet, or the ACME challenge is being blocked |
