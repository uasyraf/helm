# helm

[![tests](https://img.shields.io/badge/tests-40%20passing-brightgreen)](#) [![node](https://img.shields.io/badge/node-22%2B-blue)](#) [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Plug-and-play MCP server + dashboard giving Claude Code users **durable, multi-developer project state** — sprints, epics, stories, tasks, and **code-linked tech debt** — surviving across sessions and shared across teammates.

The differentiator: the killer metric that incumbents structurally cannot compute.

```
[helm] sprint-12 (d3/14) | stories: 2/5 done | debt: 14 (Δ+2)
                                                       ^^^^^
                              debt opened this sprint − debt closed this sprint
```

Linear and Jira can't see code, so they can't tell you whether this sprint paid down debt or accumulated it. helm can.

## Install

```bash
# Prerequisite: Node 22+
claude mcp add helm -- npx -y @uasyraf/helm
npx @uasyraf/helm install-hooks    # SessionStart banner + PostToolUse scanner + statusline
npx @uasyraf/helm install-skills   # slash commands (/sprint, /story, /debt, ...)
```

That's it. Open a Claude Code session and the banner appears. Edit a file with a `// DEBT(...)` marker, run `/debt`, and the item shows up.

**Onboarding a team or BYOS Postgres setup?** See **[ONBOARDING.md](ONBOARDING.md)** — three install paths (solo, Turso sync, Postgres, optional HTTP server), first-session checklist, troubleshooting table, and an env-var cheatsheet.

## What you get

| Surface | Purpose |
|---|---|
| **MCP server** (22 tools) | `get_status`, `open_story`, `move_story`, `close_story`, `log_debt`, `record_decision`, `sprint_review`, ... |
| **Auto-invocable skill** | `project-tracker` routes "what's the sprint status?" and "log this as debt" naturally |
| **6 slash commands** | `/sprint`, `/story`, `/epic`, `/debt`, `/backlog`, `/review` |
| **SessionStart banner** | One-line summary at every session start |
| **Statusline segment** | Same banner pinned to the bottom of the editor |
| **PostToolUse scanner** | Detects `DEBT(...)` markers, 500-line files, `: any` introductions automatically |
| **Dashboard** | SvelteKit app — home (killer metric, top debt, events), debt board, sprints (velocity), sprint detail, decisions (ADR-lite) |
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

## HTTP team mode

```bash
HELM_API_TOKEN=secret helm serve --http --port 4500
# /health returns 200; /mcp accepts bearer-authenticated MCP sessions
```

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
| 4 — Hosted (OAuth, managed instances, marketplace) | deferred — gated on external demand |

See `docs/PRD.md` for the full design conversation.

## License

MIT. See [LICENSE](LICENSE).
