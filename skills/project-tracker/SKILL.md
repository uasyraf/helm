---
name: project-tracker
description: Use when the user asks about durable project state — sprints, epics, stories, tasks, tech debt, decisions — or wants to record/log/check status across sessions. Triggers on phrases like "what's the state of", "log this as debt", "open a story", "sprint status", "debt delta", "who's working on", or any mention of helm/tracker tools.
---

# project-tracker

You have access to the helm MCP server, which gives this project durable, shared state across Claude sessions and across teammates.

## When to invoke

Use helm tools whenever the user references project-level state that should survive the session. Examples:

- "what's our sprint status?" → `get_status`
- "open a story for the dashboard refactor" → `open_story`
- "log this as tech debt" → `log_debt`
- "move STORY-123 to the current sprint" → `move_story`
- "what's the debt delta this sprint?" → `get_status` (or `sprint_review` if a sprint just closed)
- "record this decision" → `record_decision`
- "what did Alice do this week?" → `who_did_what(handle="alice")`

## Boundary with other tools

- **TodoWrite** = per-session decomposition. Throw-away. Not shared with teammates.
- **helm task** = durable, team-shared implementation step inside a story. Survives sessions.
- **claude-mem** = conversation memory. "What did I try yesterday?" goes there.
- **helm** = project state. "What's the state of the auth epic?" goes here.

If unsure: durable + shared = helm. Per-session + personal = TodoWrite. Conversation recall = claude-mem.

## Remote-mode first turn — IMPORTANT

If the helm MCP server is configured to point at a remote URL (Claude Code's `/mcp` shows it as a remote / OAuth-protected server, not a local stdio process), the session starts **with no project bound**. Tool calls other than `set_active_project` and `list_accessible_projects` will return `{ error: { code: "NO_ACTIVE_PROJECT" } }` until a project is selected.

On the **first** turn against a remote helm:

1. Detect the project slug from the cwd: parse `git remote get-url origin` (e.g. `git@github.com:acme/billing.git` → slug `billing`), or fall back to the directory basename.
2. Call `set_active_project({ slug: <inferred-slug> })`.
3. If that returns `FORBIDDEN` (the user's token has no access to that slug), call `list_accessible_projects` and offer the user the list to pick from. Do not silently pick a different project.
4. After a successful `set_active_project`, proceed with the user's request.

For stdio-mode (local helm via `npx -y @uasyraf/helm`) the session is auto-bootstrapped from the cwd's git remote — no `set_active_project` call is needed.

### Login

Remote helm uses OAuth 2.1. If the user has never authenticated, Claude Code's `/mcp` panel shows the server as needing login; the user runs the inline login command, the browser opens to the Keycloak realm, they sign in, the token is stored by Claude Code. After that the session works transparently. There is **no token file to manage** — Claude Code refreshes it automatically.

## Tool surface

| Tool | Use for |
|---|---|
| `set_active_project` / `list_accessible_projects` | Remote-mode session bootstrap (see above) |
| `get_status` | Active sprint, story counts, open debt, killer metric |
| `start_sprint` / `end_sprint` | Sprint lifecycle |
| `sprint_review` | Sprint summary including debt delta |
| `open_epic` / `update_epic` / `close_epic` | Cross-sprint themes |
| `open_story` / `update_story` / `move_story` / `close_story` | The unit that gets pulled into a sprint |
| `list_backlog` | Unsprinted stories by priority |
| `open_task` / `update_task` / `close_task` | Implementation steps inside a story |
| `log_debt` / `close_debt` / `list_debt` | Code-linked tech debt — the killer feature |
| `record_decision` | ADR-lite capture |
| `log_progress` | Free-form timeline event |
| `link_mission` | Nelson Step 3 seam |
| `who_did_what` | Developer activity feed |

## Conventions

- Story IDs are UUIDs. Don't make them up — fetch from `list_backlog` or `get_status` first.
- The active sprint is auto-detected from session context. Pass `sprintId` explicitly only when targeting a different sprint.
- When the user describes work that hasn't been opened as a story yet, suggest `open_story` first, then record progress against it.
- Debt items should include `location` (`file:line` or symbol path) whenever the conversation references specific code.

## Banner format

The SessionStart hook prints: `[helm] sprint-N (dX/Y) | stories: a/b done | debt: N (Δ±M)`.
- `dX/Y` = day X of an Y-day sprint
- `a/b` = stories done / total in sprint
- `Δ±M` = debt opened minus closed this sprint (the killer metric)
