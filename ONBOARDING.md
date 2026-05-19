# Onboarding helm

Four install paths. Pick the one that matches your shape of use.

| Path | Best for | What you operate | Auth |
|---|---|---|---|
| A — Solo | Single dev, single machine | Nothing | None (local) |
| B — Turso sync | 2–10 distributed devs, no infra team | A free Turso DB | None at MCP layer |
| C — BYOS Postgres | Teams who already operate Postgres | Your existing Postgres | None at MCP layer |
| D — Hosted (Docker + OIDC) | Production, central server, audit trail | One container + an OIDC issuer | OIDC JWT (Keycloak, Auth0, etc) |

## Path A — Solo dev (default; zero config)

```bash
cd /path/to/your/repo
claude mcp add helm -- npx -y @uasyraf/helm
npx @uasyraf/helm install-hooks       # SessionStart banner + PostToolUse scanner + statusline
npx @uasyraf/helm install-skills      # /sprint /story /epic /debt /backlog /review
```

Open a Claude Code session — banner appears, slash commands work, MCP tools available. Edit a file with `// DEBT(owner=me): description`, the worker auto-logs it. `npx @uasyraf/helm dashboard` opens `http://127.0.0.1:4400`.

Local DB at `~/.helm/<repo-slug>.db`. Nothing leaves the machine.

## Path B — Team via Turso sync (recommended for distributed teams)

One person sets it up; teammates auto-pick it up via the committed `.helm/config.json`.

**Host (one-time, ~60 sec):**

```bash
turso db create acme-helm                                # free tier signup
URL=$(turso db show acme-helm --url)
TOKEN=$(turso db tokens create acme-helm)
npx @uasyraf/helm init --team --sync-url "$URL" --sync-token "$TOKEN"
git add .helm/config.json
git commit -m "wire helm team sync"
git push
```

**Each teammate (after pulling):**

```bash
claude mcp add helm -- npx -y @uasyraf/helm
npx @uasyraf/helm install-hooks
npx @uasyraf/helm install-skills
# next Claude Code session picks up .helm/config.json automatically
```

Each developer gets their own local embedded replica syncing against the shared Turso instance. Verified latency: writes on dev A land on dev B's machine in ~250ms.

## Path C — Team via BYOS Postgres

For teams who already operate a Postgres instance:

```bash
# Each developer:
export HELM_DB_URL=postgres://user:pass@host:5432/helm
claude mcp add helm -- npx -y @uasyraf/helm
npx @uasyraf/helm install-hooks
npx @uasyraf/helm install-skills
```

The Repository pattern dispatches to pg automatically; same MCP tool surface, data lives in shared Postgres. No local DB file.

## Path D — Hosted (Docker + OIDC)

For production deployments behind an OAuth issuer (Keycloak, Auth0, Okta — anything that mints JWTs and exposes JWKS). One container serves both `/mcp` (Claude Code) and `/v1/*` (REST: dashboards, scripts, CI), authorized by per-user `helm_projects` claims.

**Host (one-time):**

```bash
git clone https://github.com/uasyraf/helm && cd helm
docker build -t helm:dev .

docker run -d --name helm -p 8080:8080 \
  -v helm-data:/home/nonroot/data \
  -e HELM_OIDC_ISSUER=https://keycloak.example.com/realms/helm \
  -e HELM_OIDC_AUDIENCE=helm \
  -e HELM_PUBLIC_URL=https://helm.example.com \
  helm:dev
```

Optional Postgres backend: drop the volume mount and set `HELM_DB_URL=postgres://user:pw@host:5432/helm` instead.

**Provision a project (admin):**

```bash
TOKEN=$(curl -s -X POST -d "grant_type=client_credentials" \
  -d "client_id=helm-dashboard" -d "client_secret=$KC_SECRET" \
  https://keycloak.example.com/realms/helm/protocol/openid-connect/token | jq -r .access_token)

curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"slug":"acme","name":"Acme"}' \
  https://helm.example.com/v1/projects
```

**Each teammate:**

```bash
claude mcp add helm --transport http https://helm.example.com/mcp
# First call returns 401 with WWW-Authenticate; Claude Code triggers
# its native OAuth/PKCE flow against the Keycloak realm.
# After login, the model calls set_active_project({slug: "acme"})
# once per session before any other tool. The project-tracker skill
# teaches this — no manual prompting needed.
```

**Keycloak realm contract:** see [HANDOFF.md](HANDOFF.md) for the full spec — clients (`helm-mcp` public PKCE + `helm-dashboard` confidential client_credentials), required claims (`helm_projects: string[]`, `realm_access.roles`), redirect-URI wildcards for Claude Code loopback, and a copy-paste audience mapper.

**Backup / migrate:**

```bash
helm export --remote https://helm.example.com --token "$TOKEN" --out dump.json
helm import --remote https://helm.example.com --token "$TOKEN" --in dump.json
```

Equivalent to `POST /v1/admin/export` and `POST /v1/admin/import` for scripts that prefer HTTP directly.

**Dashboard pod (optional):**

```bash
HELM_URL=https://helm.example.com HELM_TOKEN="$TOKEN" \
  node /app/dashboard/build/index.js
# or run the same image with --entrypoint pointing at the dashboard build
```

The dashboard switches from direct Drizzle to a `RemoteHelmRepo` adapter that calls `/v1/*`. Architecture trade-offs that drove this layout are recorded in [DECISIONS.md](DECISIONS.md).

**Local-dev escape hatch:** set `HELM_AUTH_DISABLED=1` to bypass OIDC entirely (every caller is treated as admin). Never set this in production.

## Legacy — central HTTP server with static bearer

Predates Path D. Useful for air-gapped CI or solo HTTP usage where running an OIDC issuer would be overkill:

```bash
# Host runs the server:
HELM_API_TOKEN=teamsecret npx @uasyraf/helm serve --http --port 4500

# Teammates configure Claude Code to connect:
claude mcp add helm --transport http http://host.local:4500/mcp \
  --header "Authorization: Bearer teamsecret"
```

No multi-tenant scoping, no per-user audit (`progress_event.user_sub` stays null), no admin endpoints. Honored only when `HELM_OIDC_ISSUER` is unset.

## First-session checklist

After install, your first Claude Code session should show:

- [ ] SessionStart banner: `[helm] sprint-1 (d1/14) | stories: 0/0 done | debt: 0 (Δ0)`
- [ ] Statusline at bottom showing the same line
- [ ] `/sprint`, `/story`, `/debt` slash commands available
- [ ] MCP tools listed under `helm` server
- [ ] `npx @uasyraf/helm dashboard` boots on `http://127.0.0.1:4400`

On Path D (hosted/OIDC), additionally:

- [ ] First MCP call triggers Claude Code's OAuth flow against your Keycloak realm
- [ ] After login, `mcp__helm__list_accessible_projects` returns the slugs in your `helm_projects` claim (or all projects if you have `helm-admin`)
- [ ] `mcp__helm__set_active_project({slug})` succeeds; calls without it return `NO_ACTIVE_PROJECT`
- [ ] Subsequent `mcp__helm__get_status` reflects that project's sprint state

If any of those are missing, see Troubleshooting below.

## DEBT marker syntax (the killer feature)

The PostToolUse worker scans every Edit/Write for tagged debt:

```ts
// DEBT(owner=alice, expires=2026-Q3, severity=high, ref=DBT-12): description
# DEBT(owner=bob, expires=2026-12-01)
-- DEBT(owner=carol)
```

Comment prefixes: `//`, `#`, `--`. Fields: `owner`, `expires` (ISO date or `YYYY-Qn`), `severity` (`low|med|high|critical`), `ref`. Markers are de-duplicated by `file:line` — same line won't fire twice.

FIXME/TODO comments are **not** scanned in v1 to avoid legacy-codebase noise.

## Boundary with other tools

- **claude-mem** (conversation memory) — "what did I try yesterday?"
- **TodoWrite** (per-session, ephemeral) — your plan for the next hour
- **helm** (durable + team-shared) — sprints, stories, debt that survive sessions

Routing rule: durable + shared = helm. Per-session + personal = TodoWrite. Conversation recall = claude-mem.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| First `npx` is slow | npm fetches 460 KB tarball | One-time; subsequent runs hit cache |
| First `helm dashboard` is slow | SvelteKit build runs on first invocation | One-time ~10s |
| Banner doesn't appear in Claude Code | `install-hooks` not run, or settings.json edited externally | Re-run `install-hooks`; check `~/.claude/settings.json` for `# helm: SessionStart` tag |
| No slug detected | Not a git repo + no `.helm/project.json` | Run from inside a git repo OR `helm init --slug <name>` |
| Slug is wrong in monorepo | Auto-detect uses cwd basename / git remote | Drop `.helm/project.json` in the project's subdir: `{ "slug": "my-project", "name": "My Project" }` |
| Two devs see different state | Sync URL not set or mismatch | Check `.helm/config.json` is committed and present; verify `HELM_SYNC_URL` env not overriding |
| Worker doesn't auto-fire | PostToolUse hook not installed | `install-hooks` again; check `~/.claude/settings.json` for `# helm: PostToolUse` |
| Worker fires but no debt | DEBT marker syntax mismatch | Use exact `DEBT(key=value, ...)` form — see syntax above |
| Dashboard 401/403 | If on `--http` mode, missing/wrong `Authorization: Bearer` | Add the header with the correct `HELM_API_TOKEN` (legacy) or a fresh JWT (OIDC) |
| Postgres connection error | `HELM_DB_URL` malformed or credentials wrong | Verify with `psql "$HELM_DB_URL"`; ensure user has CREATE-TABLE rights |
| Turso free tier limits | 9 GB / 1B row reads per month | Plenty for project tracking; upgrade if you outgrow it |
| Path D: `NO_ACTIVE_PROJECT` on every tool call | Remote MCP session hasn't bound a project | Have the model call `set_active_project({slug})` once per session. `list_accessible_projects` shows what's available. The project-tracker skill teaches this automatically on remote mode. |
| Path D: `FORBIDDEN` from `set_active_project` | Slug isn't in the caller's `helm_projects` claim | Add the slug to the user's `helm_projects` attribute in Keycloak, then mint a fresh token. Admins (`helm-admin` role) bypass the filter. |
| Path D: `WWW-Authenticate` header missing on 401 | `HELM_OIDC_ISSUER` not set, or `HELM_AUTH_DISABLED=1` | Set the OIDC env vars (see [HANDOFF.md](HANDOFF.md) env table) and restart the container |
| Path D: token validates locally but rejected by helm | `aud` claim doesn't match `HELM_OIDC_AUDIENCE` | Add the `helm` audience to the Keycloak client's audience mapper |
| Path D: `helm export --remote` errors with 401 | `HELM_TOKEN` env var not set or expired | Mint a fresh service-account JWT and pass via `--token "$JWT"` or `HELM_TOKEN=$JWT` |

## Env vars cheatsheet

**Storage & sync**

| Var | Purpose | Default |
|---|---|---|
| `HELM_DB_URL` | Storage backend. `postgres://...` → BYOS pg; `memory:pglite` → in-process pg (testing); otherwise libsql at `<HELM_DATA_DIR>/<slug>.db` | unset → libsql |
| `HELM_SYNC_URL` | Turso embedded-replica sync URL | unset → no sync |
| `HELM_SYNC_TOKEN` | Auth token for sync URL | unset |
| `HELM_SYNC_INTERVAL_MS` | Turso sync polling interval | sensible default |
| `HELM_DATA_DIR` | Where local DB + worker socket live (container: `/home/nonroot/data`) | `~/.helm` |
| `HELM_HOME` | Legacy alias for `HELM_DATA_DIR` | `~/.helm` |

**HTTP server (Paths C/D)**

| Var | Purpose | Default |
|---|---|---|
| `HELM_HTTP_HOST` | Bind address | `0.0.0.0` (container) / `127.0.0.1` (local) |
| `HELM_HTTP_PORT` | Bind port | `8080` (container) / `4500` (local) |
| `HELM_PUBLIC_URL` | Public URL — used in `WWW-Authenticate` `resource_metadata` and `/.well-known/oauth-protected-resource` | required when OIDC is on |

**OIDC (Path D)**

| Var | Purpose | Default |
|---|---|---|
| `HELM_OIDC_ISSUER` | Full issuer URL (e.g. `https://keycloak.example.com/realms/helm`) | unset → OIDC off |
| `HELM_OIDC_AUDIENCE` | Required `aud` claim value | unset |
| `HELM_OIDC_JWKS_URL` | JWKS endpoint override | `${HELM_OIDC_ISSUER}/protocol/openid-connect/certs` |
| `HELM_OIDC_RESOURCE` | Resource identifier override | `$HELM_PUBLIC_URL` |
| `HELM_PROJECTS_CLAIM` | JWT claim name (array of slugs) granting per-project access | `helm_projects` |
| `HELM_ROLES_CLAIM` | Dot-path to roles array inside the JWT | `realm_access.roles` |
| `HELM_ADMIN_ROLE` | Role that bypasses per-project filter and unlocks `/v1/admin/*` and `POST /v1/projects` | `helm-admin` |
| `HELM_AUTH_DISABLED` | Bypass OIDC entirely (every caller is admin). **Never set in production.** | unset |
| `HELM_API_TOKEN` | Legacy static-bearer fallback. Honored only when `HELM_OIDC_ISSUER` is unset. | unset |

**Dashboard**

| Var | Purpose | Default |
|---|---|---|
| `HELM_URL` | REST base URL — switches dashboard from direct Drizzle to `RemoteHelmRepo` | unset → direct DB |
| `HELM_TOKEN` | Service-account JWT for `RemoteHelmRepo` and `helm export/import --remote` | unset |
| `HELM_DASHBOARD_HOST` | Local dashboard bind host | `127.0.0.1` |
| `HELM_DASHBOARD_PORT` | Local dashboard bind port | `4400` |

**Testing**

| Var | Purpose | Default |
|---|---|---|
| `HELM_INTEGRATION` | Enable integration tests against external sqld | unset → skipped |

## What ships with the package

- `dist/` — compiled MCP server, worker, banner, dashboard launcher, REST app, admin CLI
- `dashboard/build/` — pre-built SvelteKit app (Node adapter), direct-Drizzle and `RemoteHelmRepo` modes
- `skills/` — 7 slash command skills + `project-tracker` + `nelson-integration`
- `hooks/hooks.json` — SessionStart + PostToolUse + statusline bundle
- `.claude-plugin/plugin.json` — plugin manifest (for future `/plugin install`)
- `.mcp.json` — MCP server registration template
- `LICENSE`, `README.md`, `ONBOARDING.md`

About 460 KB on the wire; 1.9 MB unpacked. The container image (Path D) is built separately from the repo `Dockerfile` — it bundles the same `dist/` plus a distroless Node 22 runtime, ~225 MB total.
