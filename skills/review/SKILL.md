---
name: review
description: Sprint review — completed stories, velocity, killer metric. Use for "show me the review", "how did this sprint go?", "what was our debt delta?".
---

# /review

Sprint review surfaces the four numbers that matter:

1. Completed stories (count + titles + sizes)
2. Velocity (sized stories closed)
3. Debt opened during sprint
4. Debt closed during sprint
5. **Net delta** — the killer metric: opened − closed

## Common flows

| User says | Tool |
|---|---|
| "show me the review" | `sprint_review` (defaults to active sprint) |
| "review sprint X" | `sprint_review(sprintId: "X")` |

## Boundary

Sprint review is a **view**, not a ceremony entity. helm does not model retro/planning/standup as data rows (PRD § Agile Model). Teams run the ceremonies; helm renders the view.

The dashboard's `/sprints/[id]` route shows the same data plus the per-sprint event timeline.
