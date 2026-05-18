# Onboarding helm

Three install paths. Pick the one that matches your shape of use.

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

## Optional — central HTTP server

If you'd rather not have each teammate sync individually (e.g. air-gapped CI runners that need to log progress):

```bash
# Host runs the server:
HELM_API_TOKEN=teamsecret npx @uasyraf/helm serve --http --port 4500

# Teammates configure Claude Code to connect:
claude mcp add helm --transport http http://host.local:4500/mcp \
  --header "Authorization: Bearer teamsecret"
```

## First-session checklist

After install, your first Claude Code session should show:

- [ ] SessionStart banner: `[helm] sprint-1 (d1/14) | stories: 0/0 done | debt: 0 (Δ0)`
- [ ] Statusline at bottom showing the same line
- [ ] `/sprint`, `/story`, `/debt` slash commands available
- [ ] MCP tools listed under `helm` server
- [ ] `npx @uasyraf/helm dashboard` boots on `http://127.0.0.1:4400`

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
| Dashboard 401/403 | If on `--http` mode, missing/wrong `Authorization: Bearer` | Add the header with the correct `HELM_API_TOKEN` |
| Postgres connection error | `HELM_DB_URL` malformed or credentials wrong | Verify with `psql "$HELM_DB_URL"`; ensure user has CREATE-TABLE rights |
| Turso free tier limits | 9 GB / 1B row reads per month | Plenty for project tracking; upgrade if you outgrow it |

## Env vars cheatsheet

| Var | Purpose | Default |
|---|---|---|
| `HELM_DB_URL` | Storage backend. `postgres://...` → BYOS pg; `memory:pglite` → in-process pg (testing); otherwise libsql at `~/.helm/<slug>.db` | unset → libsql |
| `HELM_SYNC_URL` | Turso embedded-replica sync URL | unset → no sync |
| `HELM_SYNC_TOKEN` | Auth token for sync URL | unset |
| `HELM_API_TOKEN` | Bearer token for `helm serve --http` | unset → no auth |
| `HELM_HOME` | Where local DB + worker socket live | `~/.helm` |
| `HELM_DASHBOARD_HOST` | Dashboard bind host | `127.0.0.1` |
| `HELM_DASHBOARD_PORT` | Dashboard bind port | `4400` |
| `HELM_INTEGRATION` | Enable integration tests against external sqld | unset → skipped |

## What ships with the package

- `dist/` — compiled MCP server, worker, banner, dashboard launcher
- `dashboard/build/` — pre-built SvelteKit app (Node adapter)
- `skills/` — 7 slash command skills + project-tracker
- `hooks/hooks.json` — SessionStart + PostToolUse + statusline bundle
- `.claude-plugin/plugin.json` — plugin manifest (for future `/plugin install`)
- `.mcp.json` — MCP server registration template
- `LICENSE`, `README.md`

About 460 KB on the wire; 1.9 MB unpacked.
