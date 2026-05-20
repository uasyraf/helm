---
name: helm
description: Use when you need to understand what helm is, how it's structured, or what its full capability surface looks like. Triggers on "what is helm", "how does helm work", "list helm's tools", "what skills does helm provide", "I'm new to helm", or when bootstrapping a Claude session against an unfamiliar helm instance. This is the reference/onboarding skill — use project-tracker for in-flight status questions, sprint/story/epic/debt for specific entity operations.
---

# helm

A plug-and-play MCP server + dashboard that gives Claude Code users durable, multi-developer project state — sprints, epics, stories, tasks, code-linked tech debt — that survives across sessions and is shared across teammates.

The differentiator: **code-linked tech debt** with the killer metric `(debt opened during sprint) − (debt closed during sprint)`.

helm is **not** a Linear/Jira replacement (no rich sprint UX), **not** claude-mem (conversation memory lives there), and **not** TodoWrite (per-session task graph). It owns durable shared project state and nothing else.

## Operational modes

helm runs in one of two modes — bootstrap is different in each.

| Mode | Transport | Auth | Project binding |
|---|---|---|---|
| **stdio** (default — `npx -y @uasyraf/helm`) | stdio JSON-RPC, one process per project | none / `HELM_API_TOKEN` for single-tenant | auto-detected from `git remote get-url origin` on first run; one repo = one project |
| **hosted** (e.g. `https://helm.artiselite.net/mcp`) | HTTP, one process serves many tenants | OIDC JWT (Keycloak realm); discovery via RFC 9728 `/.well-known/oauth-protected-resource` | sessions start **pending** — must call `set_active_project` (or `create_project` / `join_project` first) before any other tool returns data |

### First-turn ritual for hosted mode

When the helm MCP server is remote/OAuth-protected, the session has no project bound. Tool calls other than the four always-available ones return `{ error: { code: "NO_ACTIVE_PROJECT" } }`.

1. Infer the slug from `git remote get-url origin` (e.g. `git@github.com:acme/billing.git` → `billing`) or the directory basename.
2. Try `set_active_project({ slug })`. Three outcomes:
   - **success** → proceed with the user's request
   - **NOT_FOUND** → the project doesn't exist on this helm. Ask the user: should you `create_project({ slug, name })` (caller becomes owner) or pick a different slug? Don't silently create.
   - **JOIN_REQUIRED** → project exists with `open_join: true`. Suggest `join_project({ slug })`. After joining, retry `set_active_project`.
   - **FORBIDDEN** → the project is closed-join and you're not a member. Call `list_accessible_projects` and offer the visible set.

In stdio mode this whole ritual is skipped — the session auto-bootstraps from the cwd.

## MCP tool surface (26 tools)

Four **always-available** tools (work even in pending sessions):

| Tool | Purpose |
|---|---|
| `list_accessible_projects` | Show projects the bearer is authorized for |
| `set_active_project` | Bind the session to a slug |
| `create_project` | Provision a new project; caller becomes owner. Slug must be 3-64 chars `[a-z0-9._-]`, not in the reserved set (`admin`, `api`, `v1`, `mcp`, `helm`, `well-known`). |
| `join_project` | Add caller to an `open_join` project's member table. Idempotent. |

Twenty-two **entity tools** (require an active project — all return `NO_ACTIVE_PROJECT` until `set_active_project` succeeds):

| Domain | Tools |
|---|---|
| Status / overview | `get_status` |
| Sprint | `start_sprint`, `end_sprint`, `sprint_review` |
| Epic | `open_epic`, `update_epic`, `close_epic` |
| Story | `open_story`, `update_story`, `move_story`, `close_story` |
| Backlog | `list_backlog` |
| Task | `open_task`, `update_task`, `close_task` |
| Tech debt | `log_debt`, `close_debt`, `list_debt` |
| Decision | `record_decision` |
| Progress | `log_progress`, `who_did_what` |
| Nelson seam | `link_mission` |

## Plugin surface (the four touchpoints)

helm is shipped as a Claude Code **plugin**, not a raw MCP server. The plugin surface is where most of the day-to-day routing happens; expanding it is preferred over expanding the MCP tool list.

1. **Auto-invocable skills** under `skills/`:
   - `project-tracker` — the entry-point skill; routes "what's our status", "log this as debt", etc.
   - `sprint`, `story`, `epic`, `debt`, `backlog`, `review` — domain-specific slash commands
   - `nelson-integration` — standing-orders addendum for Nelson Step 3 (`link_mission`) and Step 7 (`log_progress`)
   - `helm` (this skill) — reference/onboarding
2. **SessionStart hook** — prints a one-line banner: `[helm] sprint-N (dX/Y) | stories: a/b done | debt: N (Δ±M)`.
3. **PostToolUse(Edit|Write) hook** — async worker (port `37800 + uid % 100`) scans diffs for typed debt markers and structural smells:
   - `// DEBT(owner=X, expires=2026-Q3, ref=DBT-12)`
   - `// FIXME(expires=…)`, `// TODO(owner=…)`
   - 500+ line files, 30+ line functions, `: any` in TS
4. **Nelson addendum** — implemented as standing orders (not a `SubagentStop` hook): emit `link_mission` at Battle Plan approval, `log_progress` at Captain's Log.

## REST API (when an LLM might need it directly)

helm exposes `/v1/*` alongside `/mcp` on the same port. Most flows should use MCP tools; the REST surface is for:

- **Admin export/import** — `POST /v1/admin/export` and `POST /v1/admin/import`. Used by the nightly backup SSM job and the `helm export/import` CLI for cross-instance migration.
- **Health probes** — `GET /healthz` (returns 200 if the repo is reachable).
- **OAuth discovery** — `GET /.well-known/oauth-protected-resource` (RFC 9728; powers Claude Code's `/mcp` OAuth flow).
- **Out-of-band provisioning** — the same `POST /v1/projects` and `POST /v1/projects/:slug/join` the new MCP tools wrap. Useful for the dashboard `/create` and `/join` flows.

Every request lands one structured log line in CloudWatch: `[helm-rest] METHOD PATH STATUS DURATIONms actor=<sub|anonymous>`. `/healthz` is intentionally skipped to avoid drowning the stream in Caddy's probe.

## Architecture anchors

- **Data model** — 10 tables: `project`, `developer`, `sprint`, `epic`, `story`, `task`, `tech_debt`, `decision`, `progress_event`, `project_member`. `progress_event` is append-only; `project_member` (composite PK `(project_id, user_sub)`, role ∈ `{owner, member}`) is helm-owned authorization.
- **Authorization** in hosted mode = union of three signals: (a) the JWT `helm_projects` claim, (b) the `project_member` table, (c) `helm-admin` role bypass. The claim is preserved as an optional fast-path for IdP-managed bulk provisioning.
- **Storage** — libSQL (Turso) default with embedded replicas; Postgres optional via `TRACKER_DB_URL` and the `HelmRepo` interface (`SqliteHelmRepo` / `PgHelmRepo`).
- **Bounded contexts** — Planning (sprint/epic/story/task), Quality (tech_debt), Architecture (decision), Audit (progress_event), Membership (project_member).
- **Response schemas at API boundaries** — never expose Drizzle ORM models directly from MCP tools or REST endpoints; explicit DTOs only.
- **Constructor DI throughout** — no service locators, no global state.

## Distribution

- npm: `@uasyraf/helm` — `npx -y @uasyraf/helm` runs stdio mode immediately.
- Container: distroless arm64 image, ~225 MB, listens on `:8080`, persists to `/home/nonroot/data` (mounted volume).
- License: MIT.
- Node 22+.

## When to use which skill

| Want to… | Skill |
|---|---|
| Understand what helm is or what tools it has | `helm` (this skill) |
| Route an in-flight status / debt / sprint question to the right tool | `project-tracker` |
| Drive sprint lifecycle (start, end, review) | `sprint` |
| Open or move stories | `story` |
| Manage epics | `epic` |
| Log or close tech debt | `debt` |
| View the unsprinted backlog | `backlog` |
| Pull a sprint review with debt delta | `review` |
| Feed Nelson's Step 3 and Step 7 into the timeline | `nelson-integration` |
