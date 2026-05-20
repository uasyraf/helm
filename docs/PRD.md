# helm — PRD (v0.5)

> Status: settled design. All 16 open questions resolved (see § Open Questions). Phases 0 → 4a shipped (v0.2.0 on 2026-05-20); Phase 4b (managed instances, marketplace) deferred pending external-adoption demand. Friendly project provisioning (claim ∪ membership union) added 2026-05-20.

> **v0.5 changes (2026-05-20)**: Phase 4a shipped — REST `/v1/*` (hono) co-located with `/mcp` in a single process, OIDC JWT auth (jose + JWKS), RFC 9728 protected-resource discovery for Claude Code's native `/mcp` OAuth flow, multi-tenant runtime (`set_active_project` per MCP session, `POST /v1/projects` admin provisioning), `helm export/import` + `/v1/admin/{export,import}` for backup/migration, distroless container image (~225 MB, port 8080), dashboard `HELM_URL` remote mode. Architecture trade-offs recorded in [DECISIONS.md](../DECISIONS.md); infra contract in [HANDOFF.md](../HANDOFF.md). Phase 4 split into 4a (shipped) and 4b (deferred).

> **v0.4 changes**: all open questions resolved (Q3 sprint length 2w, Q5 task/TodoWrite boundary confirmed, Q6 dashboard auth path, Q7 LWW conflict semantics, Q8 public dashboard deferred, Q10 solo daily-driver, Q11 zero telemetry, Q12 t-shirts default, Q14 monorepo override, Q15 no-git auto-name). v1 design now load-bearing.

> **v0.3 changes**: install-UX hardening — explicit Node 22+ prereq, slug + identity fallback chains, per-sync-mode prereqs table, marketplace-deprecation fallback install path, new open questions (npm scope, monorepo, no-git env).

> **v0.2 changes**: agile model decided (Scrumban-lite); cycle → sprint, goal → epic; story inserted between epic and task; t-shirt sizing optional; local-first sync opt-in confirmed.

## Context

Claude Code users today have strong primitives for **conversation continuity** (claude-mem), **orchestration** (Nelson, complexity router), and **per-session task tracking** (TodoWrite). What's missing is durable, multi-developer **project state** — sprints, epics, stories, tech debt, developer activity — that survives across sessions and is shared across teammates working on the same project.

Existing tools split into three camps, none of which fits:

- **Incumbents (Linear, Jira, Plane)** — strong sprint/workload UX, MCP bridges exist, but heavyweight, vendor lock-in, and structurally cannot see code-level debt.
- **Git-backed markdown (Backlog.md)** — agent-friendly, zero-lock-in, but breaks past 2–5 devs (merge conflicts on every concurrent write) and has no workload/debt math.
- **Single-user MCP servers (saga-mcp, atlas-mcp-server)** — right shape, wrong scale (no multi-dev sync, no real dashboard).

The intersection of **(code-linked tech debt) + (agent-native authorship) + (multi-developer git-friendly sync) + (plug-and-play install)** is genuinely unoccupied as of mid-2026. The killer metric incumbents structurally cannot compute: **"debt added vs. paid down this sprint."**

## Vision

A plug-and-play MCP server plus dashboard that gives any Claude Code user — solo or in a team — durable project memory modeled on lightweight agile. Installs in one command, runs local-first, syncs to teammates when wanted, and is the only tool that knows whether a sprint paid down debt or accumulated it.

## Agile Model — Scrumban-lite

The product follows a pragmatic Scrumban shape — opinionated enough to give structure, lean enough to fit solo devs and small teams without forcing rituals nobody runs.

| Decision | Choice | Why |
|---|---|---|
| Cadence | Sprints (fixed-length, default 1 or 2 weeks; configurable) | Provides natural cycle boundary for the killer metric; familiar to most devs |
| Flow control | Optional WIP limits per status column | Kanban hygiene without mandating it; solo devs ignore, teams set per workflow |
| Hierarchy | Epic → Story → Task | Standard, balanced. Epic groups stories around a theme; story is a user-valued increment; task is an implementation step |
| Backlog | First-class — stories with no sprint assignment | Visible to plan from |
| Estimation | Optional t-shirt sizes (XS/S/M/L/XL/XXL) | Lower friction than story points; story points deferred until calibration matters |
| Velocity | Computed from sized stories completed per sprint | Auto-derived, not entered |
| Ceremonies | NOT modeled as entities | Sprint planning, daily standup, review, retro are user processes. Tool provides the views; teams run the ceremonies |
| Definition of Done | Per-project, free-form text on a `project.dod` field | Surfaces in story-close prompts |
| Sprint goal | One-line text field on sprint | Anchors the killer metric narrative |

Override knobs (project-level config): sprint length, WIP limits, estimation on/off, sizing scale, default story status workflow.

## Working Name

**Decided (2026-05-18): `helm`.** Product brand, CLI name, repo directory, and npm package (`@uasyraf/helm`) — all aligned. Local DB lives at `~/.helm/<slug>.db`. The repo was briefly named `tracker-mcp` during scaffolding; renamed 2026-05-18 once the product name was locked.

## Target Users

| Tier | Profile | What they need |
|---|---|---|
| Primary | Claude Code power user (solo or 2–5 dev team) | Zero-config first run, native integration, no devops |
| Secondary | Small team (5–20 devs) on shared monorepo | Sync server, dashboard, role awareness |
| Tertiary | OSS project maintainer | Public read-only dashboard, contributor tracking |
| Non-target (v1) | Enterprise (50+ devs, formal compliance certifications, SAML/SCIM) | OIDC SSO shipped in 4a; SAML, SCIM provisioning, and compliance attestations stay in 4b |

## Non-Goals

- Compete with Linear/Jira on sprint UX or keyboard shortcuts — commodity, incumbents win
- Replace claude-mem (conversation memory) — strictly different layer
- Replace TodoWrite (per-session task graph) — strictly different layer
- Native real-time collaboration (Y.js, CRDTs)
- Mobile/native apps — web dashboard only
- Custom workflow engines, automations, triggers
- Formal scrum ceremonies as first-class data (planning sessions, retros, standups stay as user processes)

## The Wedge

Three things that, combined, no other product ships:

1. **Code-linked tech debt** — markers in source (`// DEBT(owner=X, expires=2026-Q3)`) parsed and tracked as first-class debt items with provenance, expiry, severity.
2. **Agent-native authorship** — Claude is a first-class writer. Skills, hooks, and Nelson seam-points all log progress automatically.
3. **Multi-dev sync without devops** — Turso embedded replicas mean local-fast reads with optional cloud sync, no Postgres to operate.

The single number the dashboard makes unmissable: **"this sprint: +N debt items / -M closed, net Δ."** Linear can't compute it (doesn't see code). CodeScene shows it but isn't a PM tool. Backlog.md doesn't have sprints.

## Core Features `[D]`

Each is a discussion anchor — expand, cut, reshape as we iterate.

### F1: Project primitive
One repo = one project. Auto-detected from `git remote get-url origin` on first run. Slug, name, description, optional homepage. Project-level config: sprint length, WIP limits on/off, estimation on/off, DoD text.

**Auto-detection fallback chain** (slug derivation, in order):
1. `git remote get-url origin` → strip protocol and `.git`; slug = `<org>-<repo>` from last two path segments
2. No remote, git repo exists: cwd basename + one-line warning
3. No git at all: cwd basename, warn, suggest `init --slug <name>` for explicit override

**Monorepo override (proposed default — see Open Questions)** — `.helm/project.json` at any cwd ancestor pins the project boundary; nearest wins. Without an override, one git root = one project.

### F2: Sprints
Fixed-length time windows (default 2 weeks; configurable). Fields: name, sprint goal (one-line), `started_at`, `ended_at`, status (`planned | active | closed`), optional WIP limit.

**Auto-rollover (locked 2026-05-18)**: at sprint close, all stories not in `done` status are moved to backlog (`sprint_id = null`, `status = "backlog"`). Forces deliberate replanning at the next sprint planning view; prevents stale stories from auto-perpetuating. Project-level config can override to `next-sprint` (push to next sprint instead) — added when a team asks.

### F3: Epics
Cross-sprint themes ("auth overhaul", "billing v2"). Fields: title, description, status (`open | in-progress | done | dropped`), priority. Epics contain stories. Optional `target_sprint_id` for soft commitment.

### F4: Stories
User-valued increments inside an epic. The unit that gets pulled into a sprint and counts toward velocity. Fields: title, description, acceptance criteria (free-form), status (`backlog | todo | doing | review | done | dropped`), `size` (optional t-shirt), `assignee_id`, `sprint_id` (null = in backlog), `epic_id` (null = orphan story), `started_at`, `completed_at`. Cycle time = `completed_at − started_at`.

### F5: Tasks
Implementation steps inside a story. Fields: title, status (`todo | doing | done`), `assignee_id`, `blocked_by` references for dependency graphs. Lightweight — not a substitute for TodoWrite, which handles per-session decomposition.

### F6: Backlog
Not a separate entity — it's the view: `stories WHERE sprint_id IS NULL ORDER BY priority`. Sprint planning UI lets you drag from backlog into the active sprint.

### F7: Tech debt (the killer feature)
First-class debt items with: title, description, severity (low/med/high/critical), location (`file:line`), owner, expiry, optional linked story. Two creation paths:

- **Explicit** — via `/debt add "..."` or skill invocation
- **Auto-detected** — `PostToolUse(Edit|Write)` worker scans diffs for:
  - **Locked debt marker syntax (2026-05-18)**: `DEBT(key=value, key=value, ...)` preceded by any line-comment prefix. Supported prefixes: `//` (C/JS/TS/Go/Rust/Java/C#/Swift/Kotlin/PHP/Scala), `#` (Python/Ruby/shell/YAML/Perl/R), `--` (SQL/Haskell/Ada/Lua). Recognized keys: `owner`, `expires` (ISO date or `YYYY-Qn`), `severity` (`low|med|high|critical`), `ref` (free-form). Unknown keys preserved in description. Examples: `// DEBT(owner=alice, expires=2026-Q3, severity=high)`, `# DEBT(owner=bob, expires=2026-12-01)`, `-- DEBT(owner=carol)`. FIXME/TODO comments are **not** scanned in v1 — too noisy in legacy codebases.
  - files crossing 500-line threshold
  - functions over 30 lines
  - `: any` introduced in TS

Sprint close diff = `(debt opened during sprint) − (debt closed during sprint)`. Surfaces prominently on the sprint review view.

### F8: Progress events (timeline spine)
Append-only event log. Every write through the MCP server emits a row. Schema: `ts, developer, kind, ref, summary, sprint_id?`. The dashboard timeline view is `SELECT * FROM progress_event ORDER BY ts DESC`. This is also the audit trail.

`kind` enum: `sprint.* | epic.* | story.* | task.* | debt.opened | debt.closed | decision.recorded | mission.linked | mission.logged`.

### F9: Developers
Lightweight identity. Auto-created via this fallback chain on first run: `git config user.email` (preferred) → `$USER@local` (fallback) → `anonymous` with a one-time prompt to set an identity. No accounts, no login for local mode. Hosted/team mode adds API tokens. Workload view = `SUM(story.size) WHERE assignee = X AND sprint = current`.

### F10: Decisions (ADR-lite)
Captured architectural decisions with context, decision, status (`proposed | accepted | superseded`). Optional — Nelson's captain's log can auto-emit these.

### F11: Dashboard
SvelteKit web app. Reads the same DB the MCP server writes. Views:

- **Home** — active sprint status, killer metric, top debts, recent events
- **Sprint board** — Kanban columns (backlog/todo/doing/review/done), WIP indicators if enabled, drag-to-move
- **Sprint detail** — sprint goal, burndown, velocity, debt delta, completed stories
- **Backlog** — orderable list, drag-to-sprint
- **Epics** — themes view with constituent stories and progress
- **Debt board** — sortable, filterable, hotspot overlay (optional, integrates `git log --numstat`)
- **Timeline** — append-only feed of progress events
- **Developers** — last-seen, current sprint load, contributions

Embeddable iframe + standalone deploy. No realtime — page refreshes are fine for v1.

### F12: Multi-dev sync
Three modes, user picks (local-first default confirmed):

1. **Local-only** (default) — SQLite file in `~/.helm/`, no network
2. **Turso sync** — set `TRACKER_SYNC_URL=libsql://...`, embedded replicas keep local reads fast
3. **BYOS Postgres** — set `TRACKER_DB_URL=postgres://...`, same Drizzle schema

Team config lives in `.helm/config.json` (committed to repo). Teammates running `npx -y @uasyraf/helm` auto-pick it up.

**Prerequisites per mode**

| Mode | External deps |
|---|---|
| Local-only | Node 22+. Nothing else. |
| Turso sync | Node 22+, free Turso account, one-time `turso db create <name>` to get the libsql URL |
| BYOS Postgres | Node 22+, reachable Postgres URL with create-table privileges |

No mode requires running a server, opening a port, or operating a database process. Turso embedded replicas keep local reads fast even under sync.

### F13: Claude Code integration
The load-bearing four touchpoints — see "Integration Surface" below.

### F14: Nelson integration
Two seam-points in Nelson's 8-step framework:

- **Step 3 (Battle Plan approved)** → `link_mission(mission_id, story_id, sprint_id)`
- **Step 7 (Captain's Log)** → `log_progress(mission_id, files_touched, debt_added, debt_closed)`

Implemented as a Nelson standing-orders addendum, not a `SubagentStop` hook (which would fire mid-mission and create noise).

### F15: claude-mem boundary
Strict separation:

| Question | Routes to |
|---|---|
| "What did I try yesterday on auth?" | claude-mem |
| "What's the state of the auth epic?" | helm |

Coexist by picking different worker ports (`37800 + uid % 100` vs claude-mem's `37700 + uid % 100`) and orthogonal `PostToolUse` matchers.

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Node 22+) | Best MCP SDK, shared types with dashboard |
| Distribution | npm (`npx -y @uasyraf/helm`) + distroless container image | npm is the solo/team path; container is the hosted/production path. One binary builds both. |
| Transport | Tri-mode: stdio default, HTTP single-process exposing `/mcp` (Streamable HTTP, JSON-RPC) + `/v1/*` REST (hono) | One process, shared auth middleware; REST for dashboards/scripts/CI, MCP for Claude Code |
| Storage | libSQL (Turso) default, Postgres optional | Embedded replicas = microsecond reads + optional sync; Drizzle abstracts both; Repository pattern (`HelmRepo` + `SqliteHelmRepo` / `PgHelmRepo`) |
| ORM | Drizzle | Single schema → libSQL + Postgres; shared with dashboard |
| Dashboard | SvelteKit + Node adapter; direct Drizzle for solo, `RemoteHelmRepo` over REST when `HELM_URL` is set | Solo keeps zero-ceremony local read; team mode runs a dashboard pod that knows only the REST URL |
| Auth | OIDC JWT (jose + JWKS cache) for **authentication only**; per-project **authorization** is the union of (a) the `helm_projects` JWT claim, (b) helm-owned `project_member` rows, and (c) `helm-admin` role bypass. RFC 9728 `/.well-known/oauth-protected-resource` + `WWW-Authenticate` challenges for Claude Code's native `/mcp` OAuth flow. Static `HELM_API_TOKEN` is a legacy fallback; `HELM_AUTH_DISABLED=1` for local dev only. | Keycloak (or any OIDC issuer) is identity; helm owns authorization. Friendly provisioning means authenticated users can self-serve a tenant without admin intervention. |
| Tenancy | Stdio/local: one repo = one project (auto-detect). HTTP/OIDC: multi-tenant; MCP sessions start pending, `set_active_project({slug})` binds the session; REST routes scope by `/v1/projects/{slug}/...`. | Server-side cwd is `/app` in container — guessing project from filesystem is wrong; explicit slug from the model or the URL is right. |
| Container | Multi-stage: `node:22-alpine` builder → `gcr.io/distroless/nodejs22-debian12:nonroot` final. Port 8080. Data volume `/home/nonroot/data`. ~225 MB. | Smallest credible Node base with a non-root default user; logs to stdout for CloudWatch/OTLP collectors. |
| Worker | Node sidecar process | Hook handlers must return < 1s; async heavy work (debt scanning) |

### Data model (v0.3, 10 tables)

```sql
project        (id, slug, name, git_remote, dod?, sprint_length_days,
                wip_enabled, estimation_enabled, open_join, created_at)
developer      (id, project_id, handle, email?, last_seen_at)
sprint         (id, project_id, name, goal?, started_at, ended_at?, status,
                wip_limit?)
epic           (id, project_id, title, description, status, priority,
                target_sprint_id?)
story          (id, epic_id?, sprint_id?, title, description, status, size?,
                assignee_id?, started_at?, completed_at?, acceptance?, priority)
task           (id, story_id, assignee_id?, title, status, blocked_by?)
tech_debt      (id, project_id, title, description, severity, location,
                owner_id?, expires_at?, opened_at, closed_at?, linked_story_id?)
decision       (id, project_id, title, context, decision, status, decided_at)
progress_event (id, project_id, developer_id, sprint_id?, kind, ref_id,
                summary, ts)
project_member (project_id, user_sub, role, created_at)
                -- composite PK (project_id, user_sub)
                -- role ∈ {'owner', 'member'}
                -- user_sub = OIDC `sub` claim; helm-owned membership table
                -- created on POST /v1/projects (creator → owner) and
                -- POST /v1/projects/:slug/join (joiner → member, on open_join projects)
```

`project.open_join` (boolean, default `false` on existing rows; `true` for projects created via `POST /v1/projects` in v0.3+) controls whether authenticated users may self-join via `POST /v1/projects/:slug/join`. `project_member` is the helm-owned authorization table; see § Auth.

Conventions (per project CLAUDE.md):

- Response schemas at API boundaries — never expose ORM models directly
- Bounded contexts: Sprint/Epic/Story/Task is the "Planning" context; TechDebt is the "Quality" context; Decision is the "Architecture" context; ProgressEvent is the "Audit" context; ProjectMember is the "Membership" context (gates Planning access)
- Constructor DI throughout, no service locators

### Auth (identity vs authorization)

**Authentication** is delegated to the OIDC issuer (Keycloak in the reference deployment). The JWT's `sub` claim is the stable user identifier; `email`, `preferred_username`, and `name` populate `developer` rows on first authenticated write.

**Authorization** is owned by helm and resolves per-project access as a **union of three sources** (any one grants access):

1. **`helm-admin` role** (JWT `realm_access.roles`) — full-tenant bypass; can `set_active_project` any slug and reach `/v1/admin/*`.
2. **`helm_projects` JWT claim** (array of slugs) — preserved as an optional fast-path for enterprise IdP-managed bulk provisioning (e.g. SCIM-fed Keycloak attribute mappers). No longer the sole source of truth.
3. **`project_member` DB row** (helm-owned, 10th table) — created when the user calls `POST /v1/projects` (creator → `owner`) or `POST /v1/projects/:slug/join` on a project with `open_join: true` (joiner → `member`).

The union is computed on every authorization decision (per-request, per `set_active_project`, per REST scoped route). This means an authenticated user can:

- Create a tenant they own (no admin gate, no claim required) — `POST /v1/projects` is now an authenticated endpoint, not admin-only.
- Join a tenant marked `open_join: true` — `POST /v1/projects/:slug/join` registers them as a member.
- Be granted access via an IdP attribute mapper that pushes a slug into the `helm_projects` claim — useful for orgs that provision team membership upstream.

`POST /v1/projects` always seeds a `project_member` row with `role='owner'` for the creator. Newly-created projects default to `open_join: true` (friendly defaults); operators can flip the flag to lock a tenant down.

### MCP tool surface (v0.3, 24 tools)

| Tool | Purpose |
|---|---|
| `get_status` | Active sprint, in-flight stories, top debts, killer metric |
| `start_sprint` / `end_sprint` | Sprint lifecycle (close emits debt delta) |
| `open_epic` / `update_epic` / `close_epic` | Epic lifecycle |
| `open_story` / `update_story` / `move_story` / `close_story` | Story lifecycle. `move_story(id, sprint_id?)` for backlog↔sprint moves |
| `open_task` / `update_task` / `close_task` | Task lifecycle |
| `list_backlog` | Unsprinted stories, ordered by priority |
| `log_debt` / `close_debt` / `list_debt` | Debt management |
| `record_decision` | ADR-lite |
| `log_progress` | Free-form event |
| `link_mission` | Nelson seam |
| `who_did_what` | Developer activity query |
| `sprint_review` | Sprint summary: completed stories, velocity, debt delta |
| `set_active_project` | (HTTP/OIDC) Bind the MCP session to a project slug. Required first call before any other tool on remote sessions. Stdio sessions skip this. |
| `list_accessible_projects` | (HTTP/OIDC) Returns the projects available to the caller based on the union of `helm_projects` claim, `project_member` rows, and `helm-admin` role. |

All response schemas are explicit DTOs. Tools other than `set_active_project` and `list_accessible_projects` return `{ error: { code: "NO_ACTIVE_PROJECT" } }` on remote sessions until a slug is bound.

`set_active_project` outcomes:

- **Success** — `{ ok: true, project: { slug, name, ... } }` when the caller is authorized (claim ∪ membership ∪ admin).
- **`NOT_FOUND`** — `{ error: { code: "NOT_FOUND" } }` when the slug doesn't exist.
- **`FORBIDDEN`** — `{ error: { code: "FORBIDDEN" } }` when the project exists, the caller is not yet authorized, and `open_join` is `false`.
- **`JOIN_REQUIRED`** *(v0.3+)* — `{ error: { code: "JOIN_REQUIRED", message, joinable: { slug, name, open_join: true } } }` when the project exists, `open_join` is `true`, and the caller isn't yet a member. The client (Claude Code, dashboard) can prompt the user to call `POST /v1/projects/:slug/join`, then retry.

## Integration Surface

Ship as a **plugin**, not a raw MCP server. Layout:

```
helm/
├── .claude-plugin/plugin.json
├── .mcp.json
├── skills/
│   ├── project-tracker/SKILL.md     # auto-invocable, the main entry
│   ├── sprint/SKILL.md              # /sprint
│   ├── story/SKILL.md               # /story
│   ├── epic/SKILL.md                # /epic
│   ├── debt/SKILL.md                # /debt
│   ├── backlog/SKILL.md             # /backlog
│   └── review/SKILL.md              # /review (sprint review)
├── hooks/hooks.json
├── bin/{pt-hook,pt-statusline,pt-worker}
├── server/                          # MCP server (TS)
└── dashboard/                       # SvelteKit app
```

Load-bearing four touchpoints (everything else is opt-in polish):

1. **Auto-invocable `project-tracker` skill** — Claude routes status questions and "log this as debt" naturally
2. **`SessionStart` hook** — injects one-line banner: `[tracker] sprint-12 (d3/14) | stories: 2/5 done | debt: 14 (Δ+2)`
3. **`PostToolUse(Edit|Write)` hook** — async worker enqueues debt candidates
4. **Nelson addendum** — Step 3 + Step 7 auto-log Tier 3 missions

## Distribution & Install UX

**Prerequisites**
- Node 22+ (npx entry point exits with a friendly error on older Node)
- Git is recommended (powers auto-detection); not required (cwd basename fallback)

First-run flow (zero config, local-first):

```bash
claude mcp add tracker -- npx -y @uasyraf/helm
# → creates ~/.helm/<project-slug>.db
# → infers project from `git remote get-url origin` or cwd
# → registers $USER as developer
# → seeds default sprint (2 weeks, starts today)
# → ready
```

Team setup (opt-in, one extra step):

```bash
npx @uasyraf/helm init --team
# → prompts for sync URL (Turso, Postgres, or hosted)
# → writes .helm/config.json (commit this to repo)
# → teammates' next `npx -y @uasyraf/helm` picks it up automatically
```

Plugin install path (preferred):

```bash
/plugin install helm@<marketplace>
# → bundled .mcp.json registers server, hooks.json wires hooks, skills/ register slash commands
```

**Fallback install (no plugin marketplace)**

If the Anthropic plugin marketplace is unavailable, or the plugin isn't accepted into the registry, devs wire the integration manually:

```bash
claude mcp add helm -- npx -y @uasyraf/helm
npx @uasyraf/helm install-hooks   # merges hooks.json into ~/.claude/hooks.json
npx @uasyraf/helm install-skills  # symlinks skills/ into ~/.claude/skills/
```

Trades a single-line `/plugin install` for three commands. Same runtime behavior. The `install-hooks` and `install-skills` subcommands are bundled with the npm package so this path is always available.

**Hosted / container install (Phase 4a, since v0.2.0)**

For teams who want a central helm instance behind an OAuth issuer:

```bash
docker build -t helm:dev .   # or pull a published image once one exists
docker run -d -p 8080:8080 \
  -v helm-data:/home/nonroot/data \
  -e HELM_OIDC_ISSUER=https://keycloak.example.com/realms/helm \
  -e HELM_OIDC_AUDIENCE=helm \
  -e HELM_PUBLIC_URL=https://helm.example.com \
  helm:dev
```

Claude Code points at it with `claude mcp add helm --transport http https://helm.example.com/mcp` — the RFC 9728 challenge returned on the first unauthenticated request triggers Claude Code's interactive OAuth/PKCE login against the configured Keycloak realm. Subsequent MCP sessions are authenticated by the resulting JWT and authorized by the `helm_projects` claim. See [HANDOFF.md](../HANDOFF.md) for the full Keycloak realm contract (clients, redirect URIs, claim mappers, env table).

`POST /v1/projects` (admin) provisions new tenants without `cwd` detection. `POST /v1/admin/{export,import}` (and the CLI shells `helm export --remote URL --token JWT` / `helm import --remote ...`) move state in and out for backup, migration, or seeding from a phase-0 local install.

## Phased Rollout

| Phase | Scope | Done when |
|---|---|---|
| **0 — Skeleton** ✓ shipped 2026-05-18 | Local stdio server, 9 tables, `project-tracker` skill, SessionStart banner, sprint/story/task CRUD | One dev can daily-drive it |
| **1a — Worker** ✓ shipped 2026-05-18 | `PostToolUse(Edit\|Write\|MultiEdit)` debt scanner: DEBT() markers, 500-line files, `: any`. Unix-socket sidecar daemon with auto-spawn. | Auto-detected debt appears in `list_debt` within 5s of an Edit |
| **1b — Dashboard** ✓ shipped 2026-05-18 | SvelteKit + adapter-node. 4 routes: Home (killer metric, top debt, recent events), Debt (filterable list), Sprints (velocity SVG bars, sprint table), Sprint detail (stories + debt delta + timeline). Binds 127.0.0.1:4400. | `helm dashboard` boots; home view shows debt delta prominently |
| **2 — Multi-dev** ✓ shipped 2026-05-18/19 | HTTP transport (`helm serve --http`, bearer auth, `/health`), Turso embedded-replica sync, `helm init --team`, BYOS Postgres via the **Repository pattern**: `HelmRepo` interface with `SqliteHelmRepo` + `PgHelmRepo` implementations, dispatched on URL scheme (`postgres://...` → pg, otherwise libsql). Every tool, the worker, the banner, and the dashboard consume the same `HelmRepo` interface. | `/health` returns 200; two-dev sync verified against local sqld in 248ms (PRD gate: 10s); BYOS Postgres verified end-to-end through MCP tools against pglite (`open_story` + `log_debt` + `get_status` returns correct delta). All 22 tools schema-agnostic. |
| **3 — Plugin polish** ✓ shipped 2026-05-18 | 6 slash command skills (`/sprint`, `/story`, `/epic`, `/debt`, `/backlog`, `/review`) + `nelson-integration` skill (Step 3/7 standing-orders addendum). Statusline segment wired via `install-hooks`. `/decisions` dashboard route. Velocity chart already shipped in Phase 1b. | All four integration touchpoints live (skill, SessionStart, PostToolUse, Nelson). `install-hooks` wires hooks + statusline; `install-skills` symlinks all 8 skills. |
| **3.5 — Publish-readiness** ✓ shipped 2026-05-18 | README, LICENSE, `dashboard/build` bundled into npm `files`, `npm pkg fix` applied. `npm publish --dry-run` produces a clean 457 KB tarball with the `helm` bin entry preserved. | `npm publish --dry-run` exits 0 with no warnings; bin path resolves; tarball contains `dist/`, `skills/`, `hooks/`, `.claude-plugin/`, `.mcp.json`, `dashboard/build/`, `LICENSE`, `README.md` |
| **4a — Production-ready hosted surface** ✓ shipped 2026-05-20 (v0.2.0) | Single-process server exposes `/v1/*` REST (hono) alongside `/mcp` (Streamable HTTP). OIDC JWT auth via `jose` with JWKS cache; per-project authz from `helm_projects` claim; `helm-admin` role bypass. RFC 9728 `/.well-known/oauth-protected-resource` + `WWW-Authenticate` for Claude Code's native `/mcp` OAuth flow. Multi-tenant: MCP sessions start pending; `set_active_project` + `list_accessible_projects` tools; `POST /v1/projects` admin provisioning. Additive schema: `developer.oidc_sub`, `progress_event.user_sub`, `schema_meta(version=2)`; idempotent migrations on SQLite + pg; identity merge backfills `oidc_sub` on existing handles. Export/import: `POST /v1/admin/{export,import}` + `helm export/import` CLI (local or `--remote URL --token`). Distroless container (`node:22-alpine` → `gcr.io/distroless/nodejs22-debian12:nonroot`, port 8080, `/home/nonroot/data` volume, ~225 MB). `HELM_DATA_DIR` env for container-friendly paths. Dashboard `HELM_URL` switches to `RemoteHelmRepo`. `project-tracker` SKILL.md teaches first-turn `set_active_project` on remote mode. Architecture trade-offs and decisions captured in [DECISIONS.md](../DECISIONS.md); infra contract (env table, Keycloak realm, redirect URIs, claims spec) in [HANDOFF.md](../HANDOFF.md). | 82 tests pass (51 → 82); new suites cover REST routes, OIDC JWT validation, per-project authz, active-project gating, schema additive migration, export/import roundtrip, and e2e against the built binary with a real JWT. Container boot serves `/healthz` 200 with persisted volume across restart. |
| **4b — Managed offering** | Managed instances, marketplace listing, dashboard PKCE login, public dashboards (`--public`) for OSS projects | Only if external adoption demands it |

Phase 0 is one weekend for one dev. Phase 1 validates the wedge before any infrastructure commitment. Phase 4a closes the gap between "one dev's laptop" and "deployable behind any OIDC issuer" — what remains in 4b is hosted-as-a-service product surface, not infrastructure capability.

## Success Metrics `[D]`

To define explicitly:

- **Adoption** — installs / week, % retaining past day 7
- **Engagement** — events logged per dev per day, % of events auto-vs-manual
- **The metric matters** — % of teams that view the sprint-debt-delta view at least once per sprint
- **Velocity stability** — variance in story points (or sized stories) completed per sprint, post-3-sprint warmup
- **No churn signal** — teams that uninstall after week 2

## Risks & Re-evaluation Triggers

| Risk | Trigger to revisit | Mitigation |
|---|---|---|
| Linear ships code-linked debt | Linear changelog mentions code parsing | Pivot to deeper agent-native angle |
| Backlog.md adds sprints + workload | Backlog.md v2 release | Consider partnering or contributing instead of competing |
| ~~MCP enterprise auth lands (SEP-1686)~~ | ~~MCP 2026 roadmap update~~ | ~~Open Phase 4 hosted offering~~ — **resolved 2026-05-20**: Claude Code's native `/mcp` OAuth flow shipped; Phase 4a delivered OIDC + RFC 9728 + multi-tenant in v0.2.0. |
| CodeScene / Faros API maturity | Either ships public API | Call their hotspot analysis instead of replicating |
| Plugin model deprecated | Anthropic announcement | Bundled `install-hooks` / `install-skills` subcommands provide a 3-command fallback path (see Distribution & Install UX § Fallback install). Plugin status changes from "single-line install" to "3-line install" — degradation, not breakage. |
| Agile model too opinionated | User complaints about forced sprints | Add "flow mode" (Kanban only, no sprints) as project-level switch |

Re-evaluation cadence: **every 6 months** (next: Nov 2026).

## Open Questions for Discussion `[D]`

1. ~~**Name** — placeholder is `tracker-mcp`. Pick before v1.~~ **Resolved 2026-05-18: `helm`.** See § Working Name.
2. ~~**Debt marker syntax** — `// DEBT(owner=X, expires=2026-Q3, ref=DBT-12)` proposed. Friendlier alternatives? Language-agnostic comment prefix?~~ **Resolved 2026-05-18**: `DEBT(key=value, ...)` preceded by `//`, `#`, or `--`. See § F7 for full spec. FIXME/TODO not scanned in v1.
3. ~~**Sprint length default** — 2 weeks proposed. 1 week for solo devs?~~ **Resolved 2026-05-18: 2 weeks.** Project-level `sprint_length_days` (F1 config) overrides; 1-week solo cadence is a per-project knob, not a fork in the default.
4. ~~**Auto-rollover** — incomplete stories return to backlog or push to next sprint?~~ **Resolved 2026-05-18**: return to backlog. See § F2 for full spec. Project-level `rollover` override deferred until requested.
5. ~~**Task vs TodoWrite boundary** — Suggested rule: TodoWrite is per-session decomposition; tracker tasks are durable assignments shared with the team. Confirm.~~ **Resolved 2026-05-18: confirmed.** TodoWrite = ephemeral, per-session. helm `task` = durable, team-shared implementation step inside a story. project-tracker skill explicitly enforces this routing.
6. ~~**Dashboard auth (team mode)** — shared link, API token, magic link, full SSO later?~~ **Resolved 2026-05-18 / superseded 2026-05-20**: phase-2 shipped API token bearer; phase-4a (v0.2.0) replaces it with OIDC JWT validated by the same `jose` + JWKS path that authorizes `/mcp` and `/v1/*`. Dashboard in team mode reads `HELM_URL` + `HELM_TOKEN` (service-account JWT) and proxies via `RemoteHelmRepo`. Static `HELM_API_TOKEN` is preserved as a legacy fallback for solo HTTP usage. Local dashboard (no `--http`) stays localhost-only with no auth. Interactive PKCE login for human dashboard viewers is the only remaining piece, deferred to 4b (operators behind a reverse proxy with Keycloak SSO get this for free today).
7. ~~**Sync conflict semantics** — Turso handles it transparently for the append-only event log. For `story.status` updates, last-write-wins or vector-clock? Pragmatic answer: LWW for v1, revisit if it bites.~~ **Resolved 2026-05-18: LWW for v1.** Append-only events stay conflict-free by construction. Mutable rows take last-write-wins. Revisit (vector clocks / CRDTs) only if a real team reports a bite.
8. ~~**Public dashboard for OSS** — separate feature or just "team mode with `--public` flag"?~~ **Resolved 2026-05-18: deferred to Phase 4b.** Not in v1 scope. When demand surfaces, ship as `--public` flag on team mode, read-only routes only, opt-in per project.
9. ~~**License** — MIT, Apache 2.0, or AGPL (to discourage SaaS clones)?~~ **Resolved 2026-05-18: MIT.** Viral-friendly; quality is the moat, not the license.
10. ~~**First user / design partner** — who's the Phase 0 daily driver?~~ **Resolved 2026-05-18: solo (ummar@artiselite.net).** Broader design-partner search starts after npm publish. helm is currently tracking its own development in `~/.helm/helm.db` — Phase 0 daily-driver gate is met by the project itself.
11. ~~**Telemetry** — opt-in anonymous usage data, or none ever?~~ **Resolved 2026-05-18: none ever.** Hard no on phone-home. helm collects nothing, sends nothing. Re-evaluate only if reach ever genuinely matters more than trust — unlikely for a Claude-Code-adjacent tool.
12. ~~**Story sizing default** — t-shirts proposed. Story points later? Or skip sizing entirely until a team asks?~~ **Resolved 2026-05-18: t-shirts (XS/S/M/L/XL/XXL).** Implemented in `story.size` schema; project config `sizing_scale: "fibonacci"` switches to story points. Velocity chart counts done stories with size set.
13. ~~**npm scope** — `@x/` is placeholder. Options: personal scope (`@<handle>/tracker-mcp`), product scope (`@tracker-mcp/server`), unscoped (`tracker-mcp`). Decide before first publish.~~ **Resolved 2026-05-18: `@uasyraf/helm` (personal scope).** Revisit if/when a product org is created.
14. ~~**Monorepo support** — first-class subdir projects (multiple `.helm/project.json` files inside one git root) or repo-as-single-project? Default proposed: repo-as-project + optional `.helm/project.json` override at any cwd ancestor. Confirm before schema lands.~~ **Resolved 2026-05-18: repo-as-project + `.helm/project.json` override at any cwd ancestor (nearest wins).** Implemented in F1 detect.ts. First-class subdir projects deferred until a real monorepo asks for it.
15. ~~**No-git environment** — slug auto-name from cwd, refuse-and-prompt, or interactive `init` flow? Default proposed in F1: auto-name + warn, with `init --slug <name>` for explicit override.~~ **Resolved 2026-05-18: auto-name from cwd basename + one-line warning.** `init --slug <name>` override path advertised in the warning. Implemented in F1 detect.ts.
16. ~~**Per-project access provisioning (hosted mode)** — how do authenticated users get into a project? Pure `helm_projects` claim (admin/IdP-managed) or self-service?~~ **Resolved: 2026-05-20** — Claim ∪ membership union; users self-serve via `POST /v1/projects` (becomes owner) and `POST /v1/projects/:slug/join` (on `open_join` projects). `helm_projects` claim retained as IdP-managed fast-path. See § Architecture > Auth.

## Verification (how we know it works end-to-end)

**Phase 0 acceptance**

- Install: `claude mcp add tracker -- npx -y @uasyraf/helm` succeeds in fresh shell
- New session in any git repo: SessionStart banner appears with auto-inferred project name + default sprint
- `mcp__tracker__get_status` returns sensible output (active sprint, stories, debt counts) for a new project
- `open_story` → `move_story(id, sprint_id)` → `close_story` produces correct progress events and sprint counts
- Manually run `mcp__tracker__log_debt` → shows up in `mcp__tracker__list_debt` next call
- Database file exists at `~/.helm/<slug>.db` and survives Claude restart

**Phase 1 acceptance**

- Edit a file to add `// DEBT(owner=me, expires=2027-01)` → debt candidate appears in next `list_debt` call (worker latency < 5s)
- Dashboard renders at `npx @uasyraf/helm dashboard` → home view shows active sprint + killer metric
- Close debt items during a sprint, then `end_sprint` → sprint review shows debt delta correctly
- Velocity chart shows completed story points (or sized stories) per sprint

**Phase 2 acceptance**

- Two devs on same repo with `.helm/config.json` pointing at shared Turso instance → both see each other's `progress_event` rows within 10s
- `--http` mode starts: `npx @uasyraf/helm --http --port 4000` → curl `/health` returns ok, MCP inspector connects

**Phase 3 acceptance**

- `/plugin install helm` registers all hooks, skills, statusline
- Nelson Tier 3 mission completes → corresponding `progress_event` rows with `kind=mission.linked` and `kind=mission.logged` appear in dashboard timeline

**Phase 4a acceptance** (shipped 2026-05-20)

- `docker build -t helm:dev .` produces a ~225 MB image; `docker run -p 8080:8080 -v helm-data:/home/nonroot/data -e HELM_AUTH_DISABLED=1 helm:dev` serves `GET /healthz` 200
- Container restart preserves state in the mounted volume
- With OIDC env set, an unauthenticated `POST /mcp` returns `401` with `WWW-Authenticate: Bearer ... resource_metadata=...` — Claude Code's interactive `/mcp` login completes against Keycloak and subsequent calls succeed
- A token without the requested slug in `helm_projects` is rejected at `set_active_project` with `FORBIDDEN`; a token with `helm-admin` can `set_active_project` to any slug and reach `/v1/admin/*`
- `POST /v1/admin/export` followed by container wipe + `POST /v1/admin/import` restores every table (verified via story status)
- Two distinct OIDC subjects with the same handle merge to one `developer` row on first authenticated write (`oidc_sub` backfill)
- Dashboard with `HELM_URL=https://helm.example.com HELM_TOKEN=$JWT` renders the same home view that direct-Drizzle mode would

## Out of Scope (v1)

- ~~SSO / SAML / SCIM~~ — **OIDC shipped in 4a** (Keycloak, Auth0, any RFC 9728 issuer); SAML and SCIM provisioning remain out of scope
- Custom workflow engines, automation triggers, webhooks
- Mobile apps
- Realtime collaboration (CRDT, presence cursors)
- Native chat / comments on items (use the linked PR/issue)
- File attachments
- Time tracking (hour-level)
- Billing / pricing for hosted offering
- AI-generated weekly reports
- Cross-project portfolio views (one-project-at-a-time in v1)
- Formal scrum ceremonies as entities (planning sessions, retros, standups)

## Appendix A: Why these specific choices

- **Scrumban over strict Scrum or pure Kanban** — Scrum's ceremonies don't fit solo or small teams; pure Kanban loses the natural sprint boundary that powers the killer metric. Scrumban-lite keeps sprint cadence + adds optional WIP control without forcing rituals.
- **Epic→Story→Task hierarchy** — three levels is the industry default, balances expressiveness against ceremony. Initiatives (4th level) deferred; flat-with-tags rejected because the dashboard's grouping views need real parent refs.
- **T-shirt sizing over story points by default** — points require team calibration that solo devs and new teams don't have. T-shirts are immediately usable. Project config can swap to points when teams ask.
- **Ceremonies as user processes, not entities** — modeling sprint planning / retro / standup as database rows adds schema surface for negligible product value. The views (sprint board, retro = sprint review screen) are what teams actually need.
- **Turso over Postgres default** — embedded replicas keep local reads fast even when synced, no DB to operate. Postgres available for teams who already have one.
- **SvelteKit over Next.js** — smaller bundle, no RSC ceremony, direct DB access via shared Drizzle schema.
- **Plugin over raw MCP** — bundles skills/hooks/commands/statusline; raw MCP would force users to wire all of them manually, killing plug-and-play.
- **stdio default, `--http` flag** — matches official Anthropic servers; one binary; transport is a routing concern, not a data concern.
- **Markdown-in-git rejected** — Backlog.md model breaks past 2–5 devs on the `progress_event` table. Append-only log over libSQL is conflict-free.
- **No realtime sync engine** — write-heavy event log doesn't need Y.js/Convex/ElectricSQL. Page refresh + 10s polling is sufficient for v1.

## Appendix B: Override knobs (if the agile shape grates)

The Scrumban-lite shape is a *default*, not a lock. Project-level config flags:

- `sprint_length_days` — set to 7 for 1-week sprints, 14 default, custom for longer
- `wip_enabled: false` — turns off WIP limits entirely (back to plain Kanban-without-WIP)
- `estimation_enabled: false` — hides size fields, drops velocity charts
- `flow_mode: true` — disables sprints; everything is "in progress" or "done"; killer metric becomes "rolling 14-day debt delta"
- `sizing_scale: "fibonacci"` — swap t-shirts for story points (1, 2, 3, 5, 8, 13)

If "flow mode" gets used by >30% of installs we'll know the sprint default was wrong and flip it.
