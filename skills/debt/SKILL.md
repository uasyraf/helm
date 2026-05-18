---
name: debt
description: Tech debt — log, close, list. The killer feature. Use for "log this as debt", "what debt do we have?", "close DEBT-x", or anything tied to code-linked technical debt.
---

# /debt

Tech debt is helm's differentiator. Use helm MCP tools.

## Common flows

| User says | Tool | Notes |
|---|---|---|
| "log this as debt" | `log_debt` | Include `location` (`file:line`) whenever possible |
| "what debt do we have?" | `list_debt` | `includeClosed: true` for full history |
| "close that debt" | `close_debt` | Counts toward killer metric for the active sprint |

## Auto-detected debt

The PostToolUse worker scans diffs for:
- `// DEBT(key=value, ...)` markers (prefix: `//`, `#`, or `--`) — Q2-locked syntax
- Files crossing 500 lines
- TypeScript `: any` or `as any`

Auto-detected items appear in `list_debt` within seconds of an Edit/Write. They're de-duplicated by location, so the same line won't fire twice.

## Killer metric

`(debt opened this sprint) − (debt closed this sprint)` = the number Linear/Jira structurally cannot compute, because they don't see code. Surfaces in `get_status` and `sprint_review`.

## DEBT marker format

```
// DEBT(owner=alice, expires=2026-Q3, severity=high, ref=DBT-12): description
# DEBT(owner=bob, expires=2026-12-01)
-- DEBT(owner=carol)
```

Recognized fields: `owner`, `expires` (ISO date or `YYYY-Qn`), `severity` (`low|med|high|critical`), `ref`.
