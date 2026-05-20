# helm

[![tests](https://img.shields.io/badge/tests-97%20passing-brightgreen)](#) [![node](https://img.shields.io/badge/node-22%2B-blue)](#) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Plug-and-play MCP server + dashboard giving Claude Code users **durable, multi-developer project state** — sprints, epics, stories, tasks, and **code-linked tech debt** — surviving across sessions and shared across teammates.

The differentiator: the killer metric that incumbents structurally cannot compute.

```
[helm] sprint-12 (d3/14) | stories: 2/5 done | debt: 14 (Δ+2)
                                                       ^^^^^
                              debt opened this sprint − debt closed this sprint
```

Linear and Jira can't see code, so they can't tell you whether this sprint paid down debt or accumulated it. helm can.

## Quickstart

Four install paths. Pick the one matching your shape of use.

| Path | Best for | What you operate | Auth |
|---|---|---|---|
| A — Solo | Single dev, single machine | Nothing | None (local) |
| B — Joining a hosted helm | Developer joining a team server | Nothing on your side | OIDC (your operator's Keycloak) |
| C — Turso sync | 2–10 distributed devs, no infra team | A free Turso DB | None at MCP layer |
| D — BYOS Postgres | Teams who already operate Postgres | Your existing Postgres | None at MCP layer |

For deploying your own hosted helm (Path B from the operator side), see [Hosted mode](#hosted-mode-docker--oidc).

### Path A — Solo (default, zero config)

```bash
cd /path/to/your/repo
claude mcp add helm -- npx -y @uasyraf/helm
npx @uasyraf/helm install-hooks       # SessionStart banner + PostToolUse scanner + statusline
npx @uasyraf/helm install-skills      # /sprint /story /epic /debt /backlog /review
```

Open a Claude Code session — banner appears, slash commands work, MCP tools available. Edit a file with `// DEBT(owner=me): description` and the worker auto-logs it. `npx @uasyraf/helm dashboard` opens `http://127.0.0.1:4400`.

Local DB at `~/.helm/<repo-slug>.db`. Nothing leaves the machine.

### Path B — Joining a hosted helm

For the Artiselite team: `https://helm.artiselite.net` is your URL. For other deployments, substitute the URL your operator gave you.

**Prerequisites**

- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) installed (`npm i -g @anthropic-ai/claude-code` or platform installer).
- A Keycloak account in the `helm` realm — ask the helm operator for your username + initial password.
- Node 22+ for `npx -y @uasyraf/helm` invocations.
- (Optional, dashboard only) [Tailscale](https://tailscale.com/download) joined to your operator's tailnet, if the dashboard is tailnet-gated.

**1. Wire helm into Claude Code (once, globally)**

```bash
claude mcp add helm \
  --transport http \
  --url https://helm.artiselite.net/mcp
```

OAuth is handled by Claude Code automatically — no client_id/secret on the dev side.

**2. Install slash commands + SessionStart banner (once)**

```bash
npx -y @uasyraf/helm@latest install-hooks
npx -y @uasyraf/helm@latest install-skills
```

**3. Open Claude in your project**

```bash
cd ~/path/to/your-repo
claude
```

First MCP tool call opens a browser for OAuth/PKCE; Claude Code caches a refresh token (~30 days). On v0.3.0+, your first interaction with a project triggers a `JOIN_REQUIRED` payload if you aren't yet a member — call `POST /v1/projects/<slug>/join` (or use the dashboard `/join` form) on any project with `open_join: true`, or `POST /v1/projects` to create a new one (you become its owner).

### Path C — Team via Turso sync (distributed teams, no infra)

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

### Path D — Team via BYOS Postgres

For teams who already operate a Postgres instance:

```bash
# Each developer:
export HELM_DB_URL=postgres://user:pass@host:5432/helm
claude mcp add helm -- npx -y @uasyraf/helm
npx @uasyraf/helm install-hooks
npx @uasyraf/helm install-skills
```

The Repository pattern dispatches to pg automatically; same MCP tool surface, data lives in shared Postgres. No local DB file.

### How the project slug works

You don't pick the slug. helm derives it from your **git remote URL** at session start (logic in [`server/src/project/detect.ts`](./server/src/project/detect.ts)):

1. `.helm/project.json` in the repo tree, key `slug` — explicit override.
2. Git remote URL parsed as `org/repo` → `org-repo` (lowercased, dashes only).
3. No remote: directory basename (with a warning).
4. Not a git repo: directory basename (with `helm init --slug <name>` hint).

| Git remote | Slug |
|---|---|
| `git@github.com:Artiselite/aegis.git` | `artiselite-aegis` |
| `git@github.com:uasyraf/helm.git` | `uasyraf-helm` |

Preview a slug without starting Claude Code:

```bash
npx -y @uasyraf/helm@latest banner
# ▶ helm: artiselite-aegis | sprint-1 (d2/14) | stories 0/0 | debt 0 (Δ0)
```

### Day-to-day

```
> /sprint                       # current sprint, days remaining, killer metric
> /story open "CDK pipeline"    # new story
> /story move STORY-12 to current sprint
> /debt list
> /debt close DEBT-7
> /backlog                      # unsprinted stories
> /review                       # end-of-sprint review (velocity, debt delta)
```

Natural-language works too: *"log a story for the dashboard auth rewrite"*, *"what debt is open?"*, *"mark task 5 done"*, *"kick off sprint-2"*.

### First-session checklist

After install, your first Claude Code session should show:

- [ ] SessionStart banner: `[helm] sprint-1 (d1/14) | stories: 0/0 done | debt: 0 (Δ0)`
- [ ] Statusline at bottom showing the same line
- [ ] `/sprint`, `/story`, `/debt` slash commands available
- [ ] MCP tools listed under the `helm` server
- [ ] `npx @uasyraf/helm dashboard` boots on `http://127.0.0.1:4400`

On Path B (hosted/OIDC), additionally:

- [ ] First MCP call triggers Claude Code's OAuth flow against the Keycloak realm
- [ ] After login, `mcp__helm__list_accessible_projects` returns the slugs you have access to (via `helm_projects` claim, `project_member` membership, or `helm-admin` role)
- [ ] `mcp__helm__set_active_project({slug})` succeeds; calls without it return `NO_ACTIVE_PROJECT`
- [ ] If you hit a `JOIN_REQUIRED` payload, calling `POST /v1/projects/<slug>/join` succeeds and the next `set_active_project` binds the session

If any of those are missing, see [Troubleshooting](#troubleshooting).

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| First `npx` is slow | npm fetches ~460 KB tarball. One-time; subsequent runs hit cache. |
| First `helm dashboard` is slow | SvelteKit build runs on first invocation. One-time, ~10s. |
| First MCP call hangs without a browser opening | Loopback callback blocked. Check your terminal isn't intercepting `http://127.0.0.1:*`, try a fresh terminal. |
| Banner doesn't appear in Claude Code | `install-hooks` not run, or settings.json edited externally. Re-run `install-hooks`; check `~/.claude/settings.json` for `# helm: SessionStart` tag. |
| `NO_ACTIVE_PROJECT` error | SessionStart banner didn't fire, or you started Claude outside a project directory. Re-run `install-hooks`, or call `set_active_project({slug})` manually. |
| Banner prints `not a git repo` | `cd` to a checked-out repo, or run `git init && git remote add origin <url>` so helm can derive a slug. |
| Banner prints `no git remote configured — using directory name as slug` | Add a remote, or commit `.helm/project.json` with `{"slug":"<explicit-slug>"}` to lock the slug independently. |
| Slug is wrong in monorepo | Auto-detect uses git remote / cwd basename. Drop `.helm/project.json` in the project's subdir: `{ "slug": "my-project", "name": "My Project" }`. |
| Worker fires but no debt | DEBT marker syntax mismatch. Use exact `DEBT(key=value, ...)` form — see [DEBT marker syntax](#debt-marker-syntax). |
| Two devs see different state (Turso) | `.helm/config.json` not committed or mismatch. Check the file is in git and present; verify `HELM_SYNC_URL` env isn't overriding. |
| Postgres connection error | `HELM_DB_URL` malformed or credentials wrong. Verify with `psql "$HELM_DB_URL"`; ensure user has CREATE-TABLE rights. |
| Turso free tier limits | 9 GB / 1B row reads per month. Plenty for project tracking; upgrade if you outgrow it. |
| `401 Unauthorized` (Path B) after months idle | Refresh token aged out. Remove the helm OAuth entry from `~/.claude/credentials.json` and call any helm tool — fresh PKCE flow. |
| `WWW-Authenticate` header missing on 401 (Path B) | `HELM_OIDC_ISSUER` not set on the server, or `HELM_AUTH_DISABLED=1`. Server-side fix. |
| Token validates locally but rejected by helm (Path B) | `aud` claim doesn't match `HELM_OIDC_AUDIENCE`. Add the `helm` audience to the Keycloak client's audience mapper. |
| MCP returns `JOIN_REQUIRED` payload | Project is open to join but you're not a member yet. POST `/v1/projects/<slug>/join` or use the dashboard `/join` form. |
| MCP returns `FORBIDDEN` on a project you should access | Project is `open_join: false` and you have neither claim nor membership. Ask the operator to add you to `project_member` or grant the `helm_projects` claim. |
| `helm export --remote` errors with 401 | `HELM_TOKEN` env var not set or expired. Mint a fresh service-account JWT and pass via `--token "$JWT"` or `HELM_TOKEN=$JWT`. |
| Dashboard 401/403 in remote mode | Missing/wrong `HELM_TOKEN`. Use a fresh JWT (OIDC) or the static bearer (legacy `HELM_API_TOKEN` mode). |
| Tailnet dashboard won't load | `tailscale status` should show the tailnet up; resolve the dashboard hostname to a private IP. If Caddy's `@vpc` matcher is rejecting your source IP, confirm you're routing via the subnet router. |

## What you get

| Surface | Purpose |
|---|---|
| **MCP server** (26 tools) | `get_status`, `open_story`, `move_story`, `close_story`, `log_debt`, `record_decision`, `sprint_review`, `set_active_project`, `create_project`, `join_project`, ... |
| **REST API** (`/v1/*`) | Same surface over HTTP for dashboards, scripts, CI — `GET/POST /v1/projects/{slug}/...` |
| **Auto-invocable skill** | `project-tracker` routes "what's the sprint status?" and "log this as debt" naturally |
| **6 slash commands** | `/sprint`, `/story`, `/epic`, `/debt`, `/backlog`, `/review` |
| **SessionStart banner** | One-line summary at every session start |
| **Statusline segment** | Same banner pinned to the bottom of the editor |
| **PostToolUse scanner** | Detects `DEBT(...)` markers, 500-line files, `: any` introductions automatically |
| **Dashboard** | SvelteKit app — home (killer metric, top debt, events), debt board, sprints (velocity), sprint detail, decisions (ADR-lite). Solo: direct DB; team: `HELM_URL` → REST. |
| **Nelson integration** | Standing-orders addendum for Step 3 (`link_mission`) and Step 7 (`log_progress`) |

## DEBT marker syntax

The PostToolUse worker scans every Edit/Write for tagged debt:

```ts
// DEBT(owner=alice, expires=2026-Q3, severity=high, ref=DBT-12): description
# DEBT(owner=bob, expires=2026-12-01)
-- DEBT(owner=carol)
```

Comment prefix: `//`, `#`, or `--`. Recognised fields: `owner`, `expires` (ISO date or `YYYY-Qn`), `severity` (`low|med|high|critical`), `ref`. Markers are de-duplicated by `file:line` — the same line won't fire twice. FIXME/TODO are deliberately **not** scanned to avoid legacy-codebase noise.

## Dashboard

```bash
helm dashboard          # localhost:4400 (built mode)
helm dashboard --dev    # vite HMR
```

The home view surfaces the debt delta prominently. Sprint pages show velocity bars and per-sprint timelines. Debt board has open/closed filters. Decisions page is the ADR log. v0.3.0+ adds `/create` and `/join` forms — any authenticated user can self-serve project provisioning.

## Hosted mode (Docker + OIDC)

For production deployments behind an OAuth issuer (Keycloak, Auth0, Okta — anything that mints JWTs and exposes JWKS). One container serves both `/mcp` (Claude Code) and `/v1/*` (REST: dashboards, scripts, CI), authorized by the union of `helm_projects` JWT claims, `project_member` rows, and `helm-admin` role.

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

Highlights:

- **OIDC JWT auth** via `jose` with JWKS cache; per-project authorization from `helm_projects` claim ∪ `project_member` table; `helm-admin` role bypasses both and unlocks `/v1/admin/*`.
- **RFC 9728** `/.well-known/oauth-protected-resource` + `WWW-Authenticate` challenges — Claude Code's native `/mcp` OAuth flow Just Works.
- **Multi-tenant** — one helm instance hosts many projects. Remote MCP sessions start pending; the model calls `set_active_project({slug})` once per session.
- **Friendly provisioning (v0.3.0+)** — any authenticated user can `POST /v1/projects` (becomes owner; `open_join: true` by default) or `POST /v1/projects/:slug/join` on an open project. The `helm_projects` JWT claim is preserved as an optional IdP fast-path for bulk provisioning.
- **Postgres backend** — set `HELM_DB_URL=postgres://...` to skip the SQLite volume entirely.

**Provision a project (any authenticated user):**

```bash
TOKEN=$(curl -s -X POST -d "grant_type=client_credentials" \
  -d "client_id=helm-dashboard" -d "client_secret=$KC_SECRET" \
  https://keycloak.example.com/realms/helm/protocol/openid-connect/token | jq -r .access_token)

curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"slug":"acme","name":"Acme"}' \
  https://helm.example.com/v1/projects
# 201 → project row + auto-inserted owner membership for the caller's userSub
```

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

The dashboard switches from direct Drizzle to a `RemoteHelmRepo` adapter that calls `/v1/*`.

**Keycloak realm contract** — see [HANDOFF.md](HANDOFF.md) for the full spec: clients (`helm-mcp` public PKCE + `helm-dashboard` confidential client_credentials), required claims, redirect-URI wildcards for Claude Code loopback, and audience mappers. Architecture trade-offs that drove this layout are in [DECISIONS.md](DECISIONS.md).

**Local-dev escape hatch:** set `HELM_AUTH_DISABLED=1` to bypass OIDC entirely (every caller is treated as admin). **Never set in production.**

**Legacy single-process bearer mode** — for air-gapped CI or solo HTTP usage where running an OIDC issuer would be overkill:

```bash
HELM_API_TOKEN=teamsecret npx @uasyraf/helm serve --http --port 4500

# Teammates configure Claude Code to connect:
claude mcp add helm --transport http http://host.local:4500/mcp \
  --header "Authorization: Bearer teamsecret"
```

No multi-tenant scoping, no per-user audit (`progress_event.user_sub` stays null), no admin endpoints. Honored only when `HELM_OIDC_ISSUER` is unset.

## Env vars

### Storage & sync

| Var | Purpose | Default |
|---|---|---|
| `HELM_DB_URL` | Storage backend. `postgres://...` → BYOS pg; `memory:pglite` → in-process pg (testing); otherwise libsql at `<HELM_DATA_DIR>/<slug>.db` | unset → libsql |
| `HELM_SYNC_URL` | Turso embedded-replica sync URL | unset → no sync |
| `HELM_SYNC_TOKEN` | Auth token for sync URL | unset |
| `HELM_SYNC_INTERVAL_MS` | Turso sync polling interval | sensible default |
| `HELM_DATA_DIR` | Where local DB + worker socket live (container: `/home/nonroot/data`) | `~/.helm` |
| `HELM_HOME` | Legacy alias for `HELM_DATA_DIR` | `~/.helm` |

### HTTP server (Path D and operator-side)

| Var | Purpose | Default |
|---|---|---|
| `HELM_HTTP_HOST` | Bind address | `0.0.0.0` (container) / `127.0.0.1` (local) |
| `HELM_HTTP_PORT` | Bind port | `8080` (container) / `4500` (local) |
| `HELM_PUBLIC_URL` | Public URL — used in `WWW-Authenticate` `resource_metadata` and `/.well-known/oauth-protected-resource` | required when OIDC is on |

### OIDC (hosted mode)

| Var | Purpose | Default |
|---|---|---|
| `HELM_OIDC_ISSUER` | Full issuer URL (e.g. `https://keycloak.example.com/realms/helm`) | unset → OIDC off |
| `HELM_OIDC_AUDIENCE` | Required `aud` claim value | unset |
| `HELM_OIDC_JWKS_URL` | JWKS endpoint override | `${HELM_OIDC_ISSUER}/protocol/openid-connect/certs` |
| `HELM_OIDC_RESOURCE` | Resource identifier override | `$HELM_PUBLIC_URL` |
| `HELM_PROJECTS_CLAIM` | JWT claim name (array of slugs) granting per-project access via the fast-path | `helm_projects` |
| `HELM_ROLES_CLAIM` | Dot-path to roles array inside the JWT | `realm_access.roles` |
| `HELM_ADMIN_ROLE` | Role that bypasses per-project filter and unlocks `/v1/admin/*`. (Project creation is no longer admin-gated as of v0.3.0.) | `helm-admin` |
| `HELM_AUTH_DISABLED` | Bypass OIDC entirely (every caller is admin). **Never set in production.** | unset |
| `HELM_API_TOKEN` | Legacy static-bearer fallback. Honored only when `HELM_OIDC_ISSUER` is unset. | unset |

### Dashboard

| Var | Purpose | Default |
|---|---|---|
| `HELM_URL` | REST base URL — switches dashboard from direct Drizzle to `RemoteHelmRepo` | unset → direct DB |
| `HELM_TOKEN` | Service-account JWT for `RemoteHelmRepo` and `helm export/import --remote` | unset |
| `HELM_DASHBOARD_HOST` | Local dashboard bind host | `127.0.0.1` |
| `HELM_DASHBOARD_PORT` | Local dashboard bind port | `4400` |

### Testing

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
- `LICENSE`, `README.md`

About 460 KB on the wire; 1.9 MB unpacked. The container image (hosted mode) is built separately from the repo `Dockerfile` — bundles the same `dist/` plus a distroless Node 22 runtime, ~225 MB total.

## Boundary with claude-mem and TodoWrite

helm is **project state**: sprints, epics, stories, tech debt. Durable, team-shared, survives sessions.

It's not:

- **claude-mem** (conversation memory — "what did I try yesterday?")
- **TodoWrite** (per-session, ephemeral task decomposition)

If unsure: durable + shared = helm. Per-session + personal = TodoWrite. Conversation recall = claude-mem.

## Phased rollout

| Phase | Status |
|---|---|
| 0 — Skeleton (MCP server, 9 tables, banner) | ✓ shipped |
| 1a — PostToolUse worker | ✓ shipped |
| 1b — SvelteKit dashboard | ✓ shipped |
| 2 — HTTP transport, Turso sync, BYOS Postgres data layer | ✓ shipped |
| 3 — Slash commands, statusline, Nelson integration, decisions view | ✓ shipped |
| 4a — REST `/v1`, OIDC auth, multi-tenant, container | ✓ shipped (v0.2.0) |
| 4a.1 — Friendly project provisioning (claim ∪ membership union, self-serve create/join) | ✓ shipped (v0.3.0) |
| 4b — Managed instances, marketplace listing | deferred — gated on external demand |

See `docs/PRD.md` for the full design conversation.

## License

MIT. See [LICENSE](LICENSE).
