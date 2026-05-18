---
name: sprint
description: Sprint lifecycle and status. Use for "what's our sprint status", "start a new sprint", "end this sprint", "show sprint review", or any cadence-level question.
---

# /sprint

Use the helm MCP tools for sprint operations. The active sprint is auto-detected from session context.

## Common flows

| User says | Tool |
|---|---|
| "what's the sprint status?" | `get_status` |
| "start a new sprint" | `start_sprint` (optionally with `name` + `goal`) |
| "end this sprint" | `end_sprint` (auto-rolls incomplete stories to backlog per PRD F2) |
| "show me the review" / "sprint summary" | `sprint_review` (defaults to active sprint) |

## Notes

- `end_sprint` rolls incomplete stories back to backlog (locked behavior — PRD Q4). Done and dropped stories stay attached.
- Sprint length defaults to 14 days (per-project override via `sprint_length_days`).
- The killer metric — debt delta this sprint — surfaces in both `get_status` and `sprint_review`.
