# Decisions — production-ready helm

Recorded during the application-layer hardening pass on 2026-05-19 (sprint-1). Companion to `HANDOFF.md`, which is the contract the infra session reads.

## Architecture

| # | Decision | Choice | Reasoning |
|---|---|---|---|
| 1 | Service split | **One process** (`helm-server`) exposes both `/v1/*` REST and `/mcp` HTTP MCP. No separate MCP gateway, no `helm-auth` companion. | Claude Code's native MCP OAuth 2.1 (`/mcp` interactive login) removes the previously-feared OIDC-on-laptop friction. A separate gateway would add a hop and a token-file to manage for zero gain. |
| 2 | HTTP framework | **hono** (with `@hono/node-server`) | Tiny, well-typed, easy to mount alongside the raw-node MCP transport. |
| 3 | JWT library | **`jose`** | Native JWKS cache, no hand-rolled crypto. |
| 4 | API shape | **REST `/v1/projects/{slug}/...`** + JSON-RPC at `/mcp` | Slug is already the canonical project key; matches existing entity scoping; one shape consumed by dashboard, scripts, MCP. |
| 5 | Tenancy key | **`project.slug`** (existing column, unique) | Human-readable, already in URLs and banners, no schema change. |
| 6 | Storage | Existing repo abstraction unchanged. libSQL/SQLite default, Postgres via `HELM_DB_URL`. Data path moves to `HELM_DATA_DIR` (defaults to `~/.helm` locally, `/home/nonroot/data` in container). | Phase-0 data layout already has `projectId` FKs on every table — no migration needed. |
| 7 | Schema additive | New columns: `developer.oidc_sub`, `progress_event.user_sub`. New table: `schema_meta(key, value)`. Indexes on `(project_id, oidc_sub)` and `(project_id, ts DESC)`. `schema_version = 2`. | Tracks human identity across machines; idempotent ALTER on bootstrap; rolls forward cleanly from phase-0 databases. |
| 8 | User-identity merge | When an authenticated write arrives with a `sub` that matches an existing handle but the row has no `oidc_sub`, backfill the column. Subsequent writes from the same `sub` resolve to the same developer. | Preserves stdio-mode legacy rows; lets two laptops with different git handles map to one human. |
| 9 | Audit trail | `progress_event.user_sub` stamped on every authenticated write (in addition to `developer_id`). | Survives a developer-row delete; gives the dashboard a "who did this" answer keyed by JWT subject. |
| 10 | Per-session project in MCP HTTP | Sessions under OIDC start **pending** (no project bound). The model must call `set_active_project({slug})` first; other tool calls return `{ error: { code: "NO_ACTIVE_PROJECT" } }`. Stdio mode is unchanged. | Avoids guessing project from server-side cwd (always `/app` in container) while preserving the unchanged tool surface. |
| 11 | Auth claim shape | Default claim names: `helm_projects: string[]` (project slugs) and admin role under `realm_access.roles` (Keycloak idiom). All claim names env-overridable. | Matches Keycloak conventions; allows other OIDC issuers to plug in by renaming. |
| 12 | Admin role | Default `helm-admin`; admins bypass per-project filter and can `POST /v1/projects` and `POST/GET /v1/admin/import,export`. | Operations and dashboard service accounts need this. |
| 13 | Headless fallback | `HELM_TOKEN` env var consumed by CLI shells (`helm export --remote URL`, `helm import --remote URL`) and by the dashboard. | CI and service accounts (no browser) can use long-lived JWTs minted by Keycloak service-account flow. |
| 14 | Export/import format | Single JSON document, `format: 1`, includes every table. `POST /v1/admin/export` and `POST /v1/admin/import`. CLI shells: `helm export [--out|--remote] [--token]`, `helm import [--in|--remote] [--token]`. | Lets backups happen without filesystem snapshot access; survives schema upgrades because version is stamped. |
| 15 | Container | Multi-stage: `node:22-alpine` builder → `gcr.io/distroless/nodejs22-debian12:nonroot` final. Port 8080. Data volume `/home/nonroot/data`. Logs to stdout. ~225 MB image. | Smallest credible Node base with a non-root default user; `/home/nonroot` is the canonical writable path under that variant. |
| 16 | Dashboard rewire | Dashboard adds `HELM_URL` + `HELM_TOKEN` env. When set, switches from direct Drizzle to a `RemoteHelmRepo` adapter that calls `/v1/*`. When unset, legacy direct-Drizzle path stays for solo users. | Lets operators run a dashboard pod that knows only the REST URL; preserves the local-only experience. |
| 17 | Logging | stdout, logfmt-friendly free-text. No file logs. | CloudWatch / OTLP collectors prefer stdout; logfmt is grep-friendly without losing structure. |

## What did NOT change

- The 22 MCP tools' input shapes and output shapes — unchanged. New: `set_active_project`, `list_accessible_projects`.
- The local stdio MCP server invocation (`npx -y @uasyraf/helm`) — unchanged behaviour.
- The `HelmRepo` interface — only additive (`findDeveloperByOidcSub?`, `setDeveloperOidcSub?`, `findTasksByProject?`). Optional methods so old impls still satisfy the type.
- The Turso embedded-replica sync path — works identically under HTTP mode.
- The PostToolUse debt scanner sidecar — local-only, untouched.

## Open / deferred

- **Multi-region / HA.** Single-instance helm-server is sufficient for the team-scale target. If we outgrow it, the Postgres path is already supported (`HELM_DB_URL=postgres://…`), and the service is stateless beyond the DB.
- **Dashboard interactive login.** Dashboard currently reads service-account-style env vars (`HELM_URL`, `HELM_TOKEN`). A first-class PKCE login for human dashboard viewers is deferred — operators behind a reverse proxy with Keycloak SSO get this for free.
- **Rate limiting.** Not added; defer to ingress (envoy / ALB / API Gateway).
- **WAL `synchronous=FULL`.** libSQL defaults to `synchronous=NORMAL`. Acceptable for the team-scale target; bump in `HELM_DATA_DIR` ops doc if writes-per-second climb.
