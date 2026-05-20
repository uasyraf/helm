# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phases 0 through 3 shipped 2026-05-18/19; Phase 4a (production-ready hosted surface) shipped 2026-05-20 (v0.2.0). The codebase has: 26-tool MCP server (22 entity tools + four always-available project-lifecycle tools: `set_active_project`, `list_accessible_projects`, `create_project`, `join_project`) exposed over stdio and HTTP, REST `/v1/*` API alongside `/mcp` in a single process (hono), OIDC JWT auth via `jose` with JWKS cache and per-project authorization from the `helm_projects` claim, RFC 9728 `/.well-known/oauth-protected-resource` for Claude Code's native `/mcp` OAuth flow, multi-tenant (one helm hosts many projects), Turso embedded-replica sync, BYOS Postgres via a Repository pattern (`HelmRepo` interface with `SqliteHelmRepo` + `PgHelmRepo`), `POST /v1/admin/{export,import}` + `helm export/import` CLI for backup/migration, distroless container (~225 MB, port 8080, `/home/nonroot/data` volume), PostToolUse debt scanner sidecar, SvelteKit dashboard with `HELM_URL` remote mode, 8 slash command skills + Nelson integration addendum, statusline. 103 unit + integration + e2e tests passing. **Friendly project provisioning (2026-05-20)**: per-project authorization is the union of `helm_projects` claim, the helm-owned `project_member` table (10th table), and `helm-admin` role; authenticated users self-provision via `create_project` MCP tool (or `POST /v1/projects`) and `join_project` MCP tool (or `POST /v1/projects/:slug/join`) on `open_join` projects.

The product is **self-hosted on its own data** — open `helm dashboard` and the killer metric is live. `npm publish --dry-run` produces a clean tarball; ready to publish when the user is.

Phase 4b (managed instances, marketplace listing) is deferred per PRD § Phased Rollout: "Only if external adoption demands it." The OAuth/multi-tenant/container layer that was originally bundled under Phase 4 shipped as Phase 4a.

When asked to "build," "scaffold," or "start," check `git log` and the live codebase first; the PRD is the design conversation, not a frozen spec. Treat `[D]` sections as open for discussion. Resolved open questions are crossed out in PRD § Open Questions with the resolution date.

## What this product is

A plug-and-play MCP server + SvelteKit dashboard that gives Claude Code users durable, multi-developer project state (sprints, epics, stories, tasks, tech debt) — survives across sessions and is shared across teammates. The differentiator is **code-linked tech debt** and the killer metric: `(debt opened during sprint) − (debt closed during sprint)`. See `docs/PRD.md` § The Wedge.

It is **not** a competitor to Linear/Jira on sprint UX, a replacement for claude-mem (conversation memory), or a replacement for TodoWrite (per-session task graph). See `docs/PRD.md` § Non-Goals.

## Load-bearing architectural decisions

These are **decided** in PRD v0.3 and should not be revisited without explicit user direction:

| Area | Decision |
|---|---|
| Name | `helm`, npm package `@uasyraf/helm` (resolved 2026-05-18, PRD Q1+Q13) |
| License | MIT (resolved 2026-05-18, PRD Q9) |
| Language | TypeScript on Node 22+ (best MCP SDK, shared types with dashboard) |
| Distribution | npm via `npx -y @uasyraf/helm`, shipped as a **Claude Code plugin** (not a raw MCP server) |
| Transport | Dual-mode: stdio default, `--http` flag for team server — one binary |
| Storage | libSQL (Turso) default with embedded replicas; Postgres optional via `TRACKER_DB_URL` |
| ORM | Drizzle — single schema targets libSQL + Postgres, shared with dashboard |
| Dashboard | SvelteKit + Drizzle (Node adapter), reads the same DB the MCP server writes — no tRPC layer |
| Worker | Bun or Node sidecar for `PostToolUse(Edit|Write)` async work; hook handlers return < 1s |
| Auth | OIDC JWT (jose + JWKS) with per-project authz via `helm_projects` claim and `helm-admin` role bypass; RFC 9728 discovery for Claude Code's `/mcp` OAuth flow. `HELM_API_TOKEN` static bearer is a legacy fallback (no OIDC); `HELM_AUTH_DISABLED=1` for local dev only. Per-project authorization is the union of (a) the JWT `helm_projects` claim, (b) the helm-owned `project_member` table (10th table), and (c) `helm-admin` role bypass. Authenticated users self-provision via `POST /v1/projects` (becomes owner) and `POST /v1/projects/:slug/join` on `open_join` projects. The claim is preserved as an optional fast-path for IdP-managed bulk provisioning. |
| Local data | SQLite file at `~/.tracker/<project-slug>.db` |
| Team config | `.tracker/config.json` committed to the repo |
| Agile model | **Scrumban-lite** — Epic → Story → Task, sprints (default 14d), optional WIP, optional t-shirt sizing |
| Ceremonies | Modeled as **views, not entities** — sprint planning / retro / standup are user processes |

## Data model anchors

10 tables defined in PRD § Architecture > Data model: `project`, `developer`, `sprint`, `epic`, `story`, `task`, `tech_debt`, `decision`, `progress_event`, `project_member`. The `progress_event` table is **append-only** and is the timeline spine + audit trail. The `project_member` table (composite PK `(project_id, user_sub)`, role ∈ `{owner, member}`) is helm-owned authorization; combined with `project.open_join` (boolean) it underpins the friendly-provisioning union model. Sync conflict semantics: append-only events are conflict-free; mutable rows are last-write-wins for v1 (open question, PRD § Open Questions item 7).

Bounded contexts:
- **Planning** — sprint, epic, story, task
- **Quality** — tech_debt
- **Architecture** — decision (ADR-lite)
- **Audit** — progress_event
- **Membership** — project_member (gates Planning access in hosted mode)

## Integration surface (the four touchpoints)

Everything else is opt-in polish. PRD § Integration Surface lists these as load-bearing:

1. Auto-invocable `project-tracker` skill — Claude routes status questions and "log this as debt" naturally
2. `SessionStart` hook — one-line banner: `[tracker] sprint-12 (d3/14) | stories: 2/5 done | debt: 14 (Δ+2)`
3. `PostToolUse(Edit|Write)` hook — async worker scans diffs for typed debt markers (`// DEBT(...)`, `// FIXME(expires=...)`, `// TODO(owner=...)`), 500+ line files, 30+ line functions, `: any` in TS
4. Nelson addendum — Step 3 (`link_mission`) and Step 7 (`log_progress`); implemented as a standing-orders addendum, **not** a `SubagentStop` hook (mid-mission noise)

Coexistence with claude-mem: orthogonal `PostToolUse` matchers and a different worker port (`37800 + uid % 100` vs claude-mem's `37700 + uid % 100`).

## Repository layout (target — does not exist yet)

```
helm/
├── .claude-plugin/plugin.json
├── .mcp.json
├── skills/{project-tracker,sprint,story,epic,debt,backlog,review}/SKILL.md
├── hooks/hooks.json
├── bin/{pt-hook,pt-statusline,pt-worker}
├── server/      # MCP server (TS)
└── dashboard/   # SvelteKit app
```

When creating the skeleton, follow this exact layout — slash commands and statusline registration depend on it.

## Open questions that affect implementation

Do not silently pick a default for these — surface the trade-off and ask. From PRD § Open Questions:

- ~~**Working name** — placeholder `tracker-mcp`; alternatives: `helm`, `compass`, `logbook`, `cairn`, `keel`. Pick before v1.~~ Resolved: `helm`.
- **Debt marker syntax** — `// DEBT(owner=X, expires=2026-Q3, ref=DBT-12)` proposed; language-agnostic prefix unconfirmed.
- **Sprint length default** — 2 weeks proposed (1 week for solo?).
- **Auto-rollover** — incomplete stories return to backlog (default) or push to next sprint?
- **Task vs TodoWrite boundary** — proposed rule: TodoWrite = per-session decomposition, tracker `task` = durable team-shared assignments. Confirm before writing task semantics.
- **License** — MIT / Apache 2.0 / AGPL undecided.
- **Telemetry** — opt-in anonymous or none ever?
- **Sync conflict semantics for mutable rows** — LWW for v1, vector-clock deferred.

Full list in `docs/PRD.md` § Open Questions for Discussion.

## Phase-0 acceptance gates

Before claiming Phase 0 done, verify all of these (PRD § Verification):
- `claude mcp add helm -- npx -y @uasyraf/helm` succeeds in a fresh shell
- New session in any git repo: SessionStart banner appears with auto-inferred project name + default sprint
- `mcp__tracker__get_status` returns sensible output for a new project
- `open_story` → `move_story(id, sprint_id)` → `close_story` produces correct `progress_event` rows and sprint counts
- `log_debt` round-trips to `list_debt`
- DB file exists at `~/.tracker/<slug>.db` and survives Claude restart

## Conventions specific to this project

- **Response schemas at API boundaries** — never expose Drizzle ORM models directly from MCP tools; define explicit DTOs.
- **Constructor DI throughout** — no service locators, no global state.
- **MCP tool naming** — verbs prefixed by entity: `open_story`, `move_story`, `close_story`, `log_debt`, `link_mission`, etc. See PRD § MCP tool surface for the full v0.2 list.
- **One repo = one project** in stdio/local mode — auto-detect from `git remote get-url origin` on first run. In remote/OIDC mode one helm instance is multi-tenant; sessions start pending and `set_active_project` binds a slug per MCP session.
- **Plugin not server** — when adding capabilities, prefer the plugin surface (skill / hook / slash command / statusline) over expanding the MCP tool list.

## Working with the PRD

`docs/PRD.md` is the design conversation, not a frozen spec. When the user proposes a change that conflicts with the PRD:

1. Identify which section of the PRD is affected
2. Note whether it's a `[D]` discussion anchor (open) or a settled decision
3. If settled, surface the conflict explicitly before changing course
4. Update the PRD in the same change that updates code — they evolve together

Phase numbering, the killer metric, and the four integration touchpoints are the load-bearing structure. Everything else can move.
