---
name: epic
description: Epic lifecycle — open, update, close. Cross-sprint themes that group stories. Use for "open an epic for X", "close the auth epic", or theme-level planning.
---

# /epic

Epics are cross-sprint themes (e.g. "auth overhaul", "billing v2"). Each epic contains stories. Use helm MCP tools.

## Common flows

| User says | Tool |
|---|---|
| "open an epic for X" | `open_epic` |
| "close the X epic" | `close_epic` (set `dropped: true` to mark dropped instead of done) |
| "update the epic" | `update_epic` |

## Notes

- Optional `target_sprint_id` for soft commitment. Stories under the epic can be in any sprint.
- Status enum: `open | in-progress | done | dropped`.
- Priority 1 (highest) to 5 (lowest), default 3.
