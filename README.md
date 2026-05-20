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

Two install paths. Pick the one that matches your scenario.

### Joining a hosted helm (team deployment)

For the Artiselite team: `https://helm.artiselite.net` is your URL. For other deployments, substitute the URL your operator gave you.

**Prerequisites**

- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) installed (`npm i -g @anthropic-ai/claude-code` or platform installer).
- A Keycloak account in the `helm` realm at [`auth.artiselite.net`](https://auth.artiselite.net) — ask the helm operator for your username + initial password.
- Node 22+ for `npx -y @uasyraf/helm` invocations.
- (Optional, dashboard only) [Tailscale](https://tailscale.com/download) joined to the Artiselite tailnet — see [`aegis/headscale/README.md`](https://github.com/Artiselite/aegis/blob/main/headscale/README.md).

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

First MCP tool call opens a browser to `auth.artiselite.net`; Claude Code caches a refresh token (~30 days). On v0.3.0+ helm, your first interaction with a new project triggers a `JOIN_REQUIRED` payload — call `POST /v1/projects/<slug>/join` (or use the dashboard `/join` form) on any project with `open_join: true`, or `POST /v1/projects` to create a new one (you become its owner).

### Self-host / local single-user

```bash
# Prerequisite: Node 22+
claude mcp add helm -- npx -y @uasyraf/helm
npx @uasyraf/helm install-hooks    # SessionStart banner + PostToolUse scanner + statusline
npx @uasyraf/helm install-skills   # slash commands (/sprint, /story, /debt, ...)
```

That's it. Open a Claude Code session and the banner appears. Edit a file with a `// DEBT(...)` marker, run `/debt`, and the item shows up. For BYOS Postgres, Turso sync, or first-session checklists, see **[ONBOARDING.md](ONBOARDING.md)**. For Docker + OIDC team deployment, see [Hosted mode](#hosted-mode-docker--oidc) below.

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

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| First MCP call hangs without a browser opening | Loopback callback blocked. Check your terminal isn't intercepting `http://127.0.0.1:*`, try a fresh terminal. |
| `401 Unauthorized` after months idle | Refresh token aged out. Remove the helm OAuth entry from `~/.claude/credentials.json` and call any helm tool — fresh PKCE flow. |
| `NO_ACTIVE_PROJECT` error | SessionStart banner didn't fire, or you started Claude outside a project directory. Re-run `install-hooks`, or call `set_active_project({slug})` manually. |
| MCP returns `JOIN_REQUIRED` payload | Project is open to join but you're not a member yet. POST `/v1/projects/<slug>/join` or use the dashboard `/join` form. |
| MCP returns `FORBIDDEN` on a project you should access | Project is `open_join: false` and you have neither claim nor membership. Ask the operator to add you to the `project_member` table or grant the `helm_projects` claim (legacy). |
| `dash.helm.artiselite.net` won't load | `tailscale status` should show the tailnet up; `getent hosts dash.helm.artiselite.net` should return `10.0.x.x`. If still failing, Caddy's `@vpc` matcher is rejecting your source IP — confirm you're routing via the headscale subnet router. |
| Banner prints `not a git repo` | `cd` to a checked-out repo, or run `git init && git remote add origin <url>` so helm can derive a slug. |
| Banner prints `no git remote configured — using directory name as slug` | Add a remote, or commit `.helm/project.json` with `{"slug":"<explicit-slug>"}` to lock the slug independently. |

## What you get

| Surface | Purpose |
|---|---|
| **MCP server** (24 tools) | `get_status`, `open_story`, `move_story`, `close_story`, `log_debt`, `record_decision`, `sprint_review`, `set_active_project`, ... |
| **REST API** (`/v1/*`) | Same surface over HTTP for dashboards, scripts, CI — `GET/POST /v1/projects/{slug}/...` |
| **Auto-invocable skill** | `project-tracker` routes "what's the sprint status?" and "log this as debt" naturally |
| **6 slash commands** | `/sprint`, `/story`, `/epic`, `/debt`, `/backlog`, `/review` |
| **SessionStart banner** | One-line summary at every session start |
| **Statusline segment** | Same banner pinned to the bottom of the editor |
| **PostToolUse scanner** | Detects `DEBT(...)` markers, 500-line files, `: any` introductions automatically |
| **Dashboard** | SvelteKit app — home (killer metric, top debt, events), debt board, sprints (velocity), sprint detail, decisions (ADR-lite). Solo: direct DB; team: `HELM_URL` → REST. |
| **Nelson integration** | Standing-orders addendum for Step 3 (`link_mission`) and Step 7 (`log_progress`) |

## DEBT marker syntax

The PostToolUse worker scans new code for tagged debt:

```ts
// DEBT(owner=alice, expires=2026-Q3, severity=high, ref=DBT-12): description
# DEBT(owner=bob, expires=2026-12-01)
-- DEBT(owner=carol)
```

Comment prefix: `//`, `#`, or `--`. Recognised fields: `owner`, `expires` (ISO date or `YYYY-Qn`), `severity` (`low|med|high|critical`), `ref`. FIXME/TODO are deliberately **not** scanned to avoid legacy-codebase noise.

## Multi-dev sync (Phase 2)

Three modes, your pick — local-first is the default:

| Mode | Prereqs |
|---|---|
| **Local-only** (default) | Node 22+. Nothing else. SQLite file at `~/.helm/<slug>.db`. |
| **Turso sync** | Node 22+, free Turso account, one-time `turso db create <name>` to get the libsql URL. |
| **BYOS Postgres** | Node 22+, reachable Postgres URL with create-table privileges. |

```bash
# Team setup:
turso db create helm-acme
helm init --team \
  --sync-url $(turso db show helm-acme --url) \
  --sync-token $(turso db tokens create helm-acme)
# Commit .helm/config.json. Teammates auto-pick it up.
```

## Dashboard

```bash
helm dashboard          # localhost:4400 (built mode)
helm dashboard --dev    # vite HMR
```

The home view surfaces the debt delta prominently. Sprint pages show velocity bars and per-sprint timelines. Debt board has open/closed filters. Decisions page is the ADR log.

## Hosted mode (Docker + OIDC)

For team or production deployment, helm ships as a multi-stage distroless container (~225 MB) exposing both `/mcp` and `/v1/*` on port 8080, with OIDC JWT validation against any RFC 9728-compatible issuer (Keycloak, Auth0, etc).

```bash
docker build -t helm:dev .
docker run -d --name helm -p 8080:8080 \
  -v helm-data:/home/nonroot/data \
  -e HELM_OIDC_ISSUER=https://keycloak.example.com/realms/helm \
  -e HELM_OIDC_AUDIENCE=helm \
  -e HELM_PUBLIC_URL=https://helm.example.com \
  helm:dev
```

Highlights:

- **OIDC JWT auth** via `jose` with JWKS cache; per-project authorization from the `helm_projects` claim; `helm-admin` role bypasses the project filter and unlocks `/v1/admin/*`.
- **RFC 9728** `/.well-known/oauth-protected-resource` + `WWW-Authenticate` challenges — Claude Code's native `/mcp` OAuth flow Just Works.
- **Multi-tenant** — one helm instance hosts many projects. Remote MCP sessions start pending; the model calls `set_active_project({slug})` once per session. Any authenticated user can provision a project via `POST /v1/projects` (becomes owner) or join an open one via `POST /v1/projects/:slug/join`. Membership stored in helm's `project_member` table; the `helm_projects` JWT claim is preserved as an optional IdP fast-path.
- **Postgres backend** — set `HELM_DB_URL=postgres://...` to skip the SQLite volume entirely.
- **Backup / migrate** — `POST /v1/admin/export` and `POST /v1/admin/import` JSON snapshots; same flow via `helm export --remote <url> --token <jwt>` and `helm import --remote ...`.
- **Dashboard remote mode** — set `HELM_URL` (+ `HELM_TOKEN` if OIDC is on) and the dashboard switches to `RemoteHelmRepo` over REST.

Local-dev shortcut: `-e HELM_AUTH_DISABLED=1` bypasses OIDC entirely (treats every caller as admin — never set this in production).

Legacy single-process bearer mode is still available for solo HTTP usage:

```bash
HELM_API_TOKEN=secret helm serve --http --port 4500
```

Full env table, Keycloak realm contract, and redirect-URI spec: see **[HANDOFF.md](HANDOFF.md)**. Architecture trade-offs: **[DECISIONS.md](DECISIONS.md)**.

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
