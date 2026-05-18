---
name: nelson-integration
description: Standing-orders addendum for Nelson — emit link_mission at Step 3 (Battle Plan approved) and log_progress at Step 7 (Captain's Log). Auto-invokes whenever Nelson runs a Tier 3 mission.
---

# helm + Nelson integration

Two seam-points in Nelson's 8-step framework write durable project state to helm:

## Step 3 — Battle Plan approved

Immediately after the user approves the battle plan (Nelson's Step 5 permission gate), the squadron should call:

```
mcp__helm__link_mission(
  missionId: "<nelson mission id>",
  storyId: "<helm story id, if the mission targets one>",
  sprintId: "<active sprint id, optional — defaults to active>",
  summary: "<one-line mission brief>"
)
```

This creates a `progress_event` row with `kind=mission.linked`, anchoring the mission to the planning surface. If the user hasn't opened a story yet, ask first — "Should I open a story for this mission?" — then call `open_story` followed by `link_mission`.

## Step 7 — Captain's Log

After Nelson's captain's log is written, the squadron should call:

```
mcp__helm__log_progress(
  summary: "<mission complete: X files touched, Y debt added, Z debt closed>",
  refId: "<nelson mission id>"
)
```

This creates a `progress_event` row with `kind=progress.logged` tied to the mission. The dashboard's `/sprints/[id]` timeline then shows the mission alongside organic story/debt events.

## Why a standing-orders addendum, not a hook

Nelson's `SubagentStop` would fire mid-mission (after every subagent returns), producing noise. The Step 3 and Step 7 calls are deliberate captain-level acts, not subagent-level signals — they belong in Nelson's documented flow, not in a hook config.

## Failure mode

If helm isn't installed in the user's environment, both MCP calls return tool-not-found. Nelson should swallow this silently — helm integration is opt-in, not load-bearing.
