# HANDOFF.md — what the infra session needs to provision

This document is the contract between the application work (this branch) and the infra work that follows. It lists every concrete thing the helm container expects from the environment, plus the Keycloak realm contract.

## Image

- **Build**: `docker build -t helm:<tag> .` from the repo root.
- **Base**: `gcr.io/distroless/nodejs22-debian12:nonroot` (Node 22, UID 65532).
- **Size**: ~225 MB.
- **Registry tag**: build locally for now (no public image yet). Push to `ghcr.io/uasyraf/helm:<tag>` or the org's ECR once the infra side has a registry in place.

## Network

| Port | Path | Auth | Purpose |
|---|---|---|---|
| 8080 | `GET /healthz` | none | liveness/readiness — 200 when DB is reachable, 503 otherwise |
| 8080 | `GET /.well-known/oauth-protected-resource` | none | RFC 9728 discovery, points at Keycloak issuer |
| 8080 | `POST /mcp` | OAuth Bearer | MCP HTTP transport (Streamable, JSON-RPC) |
| 8080 | `GET\|POST /v1/...` | OAuth Bearer | REST API |

- ALB / ingress: route everything to port 8080. Path-based split unnecessary — the server already dispatches internally.
- Healthcheck: `GET /healthz`, expect `200 {"ok": true}`. 503 means the DB is unreachable.
- The MCP path returns `401 WWW-Authenticate: Bearer realm="helm", resource_metadata="<resourceUrl>/.well-known/oauth-protected-resource"` when no/invalid token. Claude Code's `/mcp` interactive flow keys off this header.

## Filesystem

| Mount point | Purpose | Permissions |
|---|---|---|
| `/home/nonroot/data` | persistent data (SQLite DB lives here as `helm.db`, or Postgres-only mode if `HELM_DB_URL` is set) | writable by UID 65532 |

- For Postgres-only deployments, the mount can be omitted, but the env var `HELM_DB_URL=postgres://user:pw@host:5432/helm` must be set.
- For SQLite + Turso embedded-replica sync: keep the local mount AND set `HELM_SYNC_URL` + `HELM_SYNC_TOKEN`.

## Environment variables

### Required when OIDC is on

| Variable | Example | Notes |
|---|---|---|
| `HELM_OIDC_ISSUER` | `https://keycloak.artiselite.net/realms/helm` | Full issuer URL. Trailing slash optional. |
| `HELM_OIDC_AUDIENCE` | `helm` | Must match the `aud` claim Keycloak puts on tokens. |
| `HELM_PUBLIC_URL` | `https://helm.artiselite.net` | Used in WWW-Authenticate's `resource_metadata` and in `/.well-known/oauth-protected-resource`. |

### Optional OIDC tuning

| Variable | Default | Notes |
|---|---|---|
| `HELM_OIDC_JWKS_URL` | `${HELM_OIDC_ISSUER}/protocol/openid-connect/certs` | Override if Keycloak is fronted by a non-standard URL. |
| `HELM_OIDC_RESOURCE` | `$HELM_PUBLIC_URL` | Override only if the resource identifier differs from the public URL. |
| `HELM_PROJECTS_CLAIM` | `helm_projects` | JWT claim name (array of slugs) granting per-project access. |
| `HELM_ROLES_CLAIM` | `realm_access.roles` | Dot-path to the roles array inside the JWT. |
| `HELM_ADMIN_ROLE` | `helm-admin` | Role that bypasses the per-project filter and unlocks `/v1/admin/*` and `POST /v1/projects`. |

### Storage

| Variable | Default | Notes |
|---|---|---|
| `HELM_DATA_DIR` | `/home/nonroot/data` | Where `helm.db` lives. Must be writable. |
| `HELM_DB_URL` | (unset → SQLite) | `postgres://user:pw@host:5432/db` to use Postgres instead. Optional `pg` dep is bundled. |
| `HELM_SYNC_URL` / `HELM_SYNC_TOKEN` / `HELM_SYNC_INTERVAL_MS` | (unset) | Turso embedded-replica sync settings. Used only with SQLite mode. |

### HTTP

| Variable | Default | Notes |
|---|---|---|
| `HELM_HTTP_HOST` | `0.0.0.0` (container) / `127.0.0.1` (local) | Bind address. |
| `HELM_HTTP_PORT` | `8080` (container) / `4500` (local) | Bind port. |

### Other

| Variable | Default | Notes |
|---|---|---|
| `HELM_AUTH_DISABLED` | (unset) | Set to `1` for local dev to bypass OIDC entirely (treats every caller as admin). **Never set in production.** |
| `HELM_API_TOKEN` | (unset) | Legacy static-bearer fallback. Honored only when OIDC is not configured. |

## Keycloak realm requirements

The infra session needs to create (or import) a Keycloak realm whose tokens helm will accept. Concrete checklist:

### Realm

- **Name**: `helm` (or any name — must match `HELM_OIDC_ISSUER`).

### Clients

1. **`helm-mcp` (public, PKCE)** — for Claude Code's interactive MCP flow.
   - Access type: `public`.
   - Standard flow: enabled. Direct access: disabled. Service accounts: disabled.
   - **Valid redirect URIs**: must include the Claude Code loopback callbacks. Wildcard the localhost ports — Claude Code picks one at random per session:
     - `http://127.0.0.1:*`
     - `http://localhost:*`
   - **Web origins**: `+` (or echo the redirect URIs).
   - PKCE: required (`S256`).
   - Token audience mapper: add `helm` as a hardcoded audience.

2. **`helm-dashboard` (confidential, client_credentials)** — for the dashboard pod if it runs without per-user PKCE.
   - Access type: `confidential`.
   - Service accounts: enabled.
   - Audience mapper: hardcoded `helm`.
   - The dashboard reads the resulting access token via the existing token issuance flow (env: `HELM_TOKEN`).

### Claims to mint

Every token helm validates must carry:

| Claim | Type | Where it comes from | Used by |
|---|---|---|---|
| `iss` | string | Keycloak issuer URL | `jose` verification |
| `aud` | string or string[] | `helm` | `jose` verification |
| `sub` | string | Keycloak user ID | Stamped on every `progress_event.user_sub`. Persisted on `developer.oidc_sub`. |
| `preferred_username` | string | Keycloak username | Display handle; falls back to email or sub. |
| `email` | string | optional | Display only. |
| `helm_projects` | string[] | **mapper required** — list of project slugs the user can touch | Authorization gate on `/v1/projects/{slug}/*` and on `set_active_project`. Override claim name via `HELM_PROJECTS_CLAIM`. |
| `realm_access.roles` | string[] | Keycloak realm role membership | Admins (`helm-admin`) bypass the project filter. Override path via `HELM_ROLES_CLAIM`. |

The `helm_projects` claim should be backed by a user-attribute mapper. The simplest setup: a multivalued user attribute called `helm_projects` is mapped to a token claim of the same name. Operations adds slugs to a user's attribute, the next token they mint includes them.

## Minimum `docker run` (no orchestration)

```bash
docker run -d --name helm \
  -p 8080:8080 \
  -v helm-data:/home/nonroot/data \
  -e HELM_OIDC_ISSUER=https://keycloak.artiselite.net/realms/helm \
  -e HELM_OIDC_AUDIENCE=helm \
  -e HELM_PUBLIC_URL=https://helm.artiselite.net \
  helm:dev
```

## Bringing up the dashboard alongside

The dashboard is a SvelteKit `adapter-node` app. In production it should run as a separate pod that points at helm via REST:

```bash
HELM_URL=https://helm.artiselite.net HELM_TOKEN=<service-account-jwt> npm start
```

The dashboard's `package.json` `start` script (`node build/index.js`) is what runs. The dashboard binary lives inside the same image at `/app/dashboard/build/index.js` — operators can either run two containers from one image (`--entrypoint /nodejs/bin/node helm:dev /app/dashboard/build/index.js`) or build a separate dashboard image. The former is simpler.

## What infra needs to decide

Items I cannot fix from the application side:

1. **DNS** — `helm.artiselite.net` → ALB / ingress.
2. **TLS** — TLS terminates at the ingress; helm itself speaks plain HTTP on 8080.
3. **Backups** — back up `/home/nonroot/data` volume *or* schedule a periodic `helm export --remote ... --token ...` to S3 (the export endpoint and CLI both work).
4. **Keycloak hosting** — separate concern; helm only needs the issuer URL to be reachable from the helm pod.
5. **Service-account JWT for dashboard** — Keycloak's client-credentials flow with `aud=helm` and the `helm-admin` role on the dashboard's service account.
6. **Migration of existing local helm state** — operators with phase-0 data run `helm export --out dump.json` against their local install, then `helm import --in dump.json --remote https://helm.artiselite.net --token <admin-jwt>` to seed the production helm.

## Local sanity test (no infra needed)

```bash
docker build -t helm:dev .
docker run -d --name helm-test -p 8080:8080 -e HELM_AUTH_DISABLED=1 \
  -v $(pwd)/.tmp-helm-data:/home/nonroot/data helm:dev
curl http://127.0.0.1:8080/healthz
curl -X POST -H 'content-type: application/json' \
  -d '{"slug":"alpha","name":"Alpha"}' \
  http://127.0.0.1:8080/v1/projects
curl http://127.0.0.1:8080/v1/projects/alpha/status
docker stop helm-test && docker start helm-test && sleep 2
curl http://127.0.0.1:8080/v1/projects/alpha/status  # state persists
curl http://127.0.0.1:8080/v1/admin/export > dump.json
docker rm -f helm-test && rm -rf .tmp-helm-data
docker run -d --name helm-test -p 8080:8080 -e HELM_AUTH_DISABLED=1 \
  -v $(pwd)/.tmp-helm-data:/home/nonroot/data helm:dev
sleep 2
curl -X POST -H 'content-type: application/json' \
  --data-binary @dump.json http://127.0.0.1:8080/v1/admin/import
curl http://127.0.0.1:8080/v1/projects/alpha/status  # state restored
docker rm -f helm-test
```

When OIDC is enabled (`HELM_AUTH_DISABLED` unset and the OIDC env vars set), substitute a bearer token from Keycloak:

```bash
TOKEN=$(curl -s -X POST \
  -d "grant_type=client_credentials" \
  -d "client_id=helm-dashboard" \
  -d "client_secret=$KC_SECRET" \
  https://keycloak.artiselite.net/realms/helm/protocol/openid-connect/token | jq -r .access_token)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/v1/projects
```
