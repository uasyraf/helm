---
name: story
description: Story lifecycle — open, update, move, close, list backlog. Use for "open a story", "move STORY-x to current sprint", "close this story", "what's in the backlog", or any user-valued-increment work.
---

# /story

Stories are the unit pulled into a sprint and counted toward velocity. Use helm MCP tools for the lifecycle.

## Common flows

| User says | Tool | Notes |
|---|---|---|
| "open a story for X" | `open_story` | Pass `sprintId` to land in sprint, omit for backlog |
| "move STORY-x to current sprint" | `move_story` | Pass `sprintId: null` to send back to backlog |
| "close this story" | `close_story` | Sets `completed_at`, marks done |
| "what's in the backlog?" | `list_backlog` | Sorted by priority |
| "update the story title" | `update_story` | Pass only the fields that change |

## Boundary with TodoWrite (resolved 2026-05-18, PRD Q5)

- **TodoWrite** = per-session, throw-away decomposition. Not shared with teammates.
- **helm story** = durable user-valued increment, team-shared, survives sessions.

If unsure: is this a long-lived thing the team needs to see? → helm story. Is this just my plan for the next hour? → TodoWrite.

## Story sizing

T-shirts (XS/S/M/L/XL/XXL) by default per PRD Q12. Velocity chart counts done stories with size set. Skip sizing if the team doesn't ask for it.
