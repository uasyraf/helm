---
name: backlog
description: View and prioritise the backlog. Use for "what's in the backlog?", "show unsprinted stories", or planning the next sprint.
---

# /backlog

The backlog is the view, not an entity: `stories WHERE sprint_id IS NULL ORDER BY priority`.

## Common flows

| User says | Tool |
|---|---|
| "what's in the backlog?" | `list_backlog` |
| "pull X into the sprint" | `move_story(id, sprintId)` |
| "send X back to backlog" | `move_story(id, sprintId: null)` |

The dashboard's `/sprints` page is the visual equivalent — use the MCP tools when the user is in a Claude session; point them at the dashboard for drag-and-plan flows.
