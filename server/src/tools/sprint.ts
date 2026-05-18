import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { newId, now } from "../util/ids.js";
import { emitEvent } from "../events/emit.js";

export const registerSprintTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "start_sprint",
    {
      title: "Start a new sprint",
      description: "Closes the current active sprint (if any) and opens a new one. Sprint length comes from project config.",
      inputSchema: {
        name: z.string().min(1).optional().describe("Optional sprint name. Defaults to sprint-N."),
        goal: z.string().optional().describe("One-line sprint goal."),
        wipLimit: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      const { repo, session } = ctx;
      await repo.closeActiveSprints(session.project.id, now());
      const seq = (await repo.countSprintsByProject(session.project.id)) + 1;

      const id = newId();
      const name = args.name ?? `sprint-${seq}`;
      await repo.insertSprint({
        id,
        projectId: session.project.id,
        name,
        goal: args.goal ?? null,
        startedAt: now(),
        endedAt: null,
        status: "active",
        wipLimit: args.wipLimit ?? null,
      });

      await emitEvent(repo, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: id,
        kind: "sprint.started",
        refId: id,
        summary: `${name} started${args.goal ? `: ${args.goal}` : ""}`,
      });

      return jsonResult({ id, name, status: "active" });
    },
  );

  server.registerTool(
    "end_sprint",
    {
      title: "End the active sprint",
      description: "Closes the active sprint. Incomplete stories return to backlog (locked default — see PRD F2).",
      inputSchema: {},
    },
    async () => {
      const { repo, session } = ctx;
      const row = await repo.findActiveSprint(session.project.id);
      if (!row) {
        return jsonResult({ error: "no active sprint" });
      }

      const incomplete = await repo.findStoriesInSprintNotDoneOrDropped(row.id);
      if (incomplete.length > 0) {
        await repo.rolloverIncompleteStoriesToBacklog(row.id);
        for (const s of incomplete) {
          await emitEvent(repo, {
            projectId: session.project.id,
            developerId: session.developer.id,
            sprintId: row.id,
            kind: "story.moved",
            refId: s.id,
            summary: `${s.title} → backlog (sprint rollover)`,
          });
        }
      }

      await repo.updateSprint(row.id, { status: "closed", endedAt: now() });
      await emitEvent(repo, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: row.id,
        kind: "sprint.ended",
        refId: row.id,
        summary: `${row.name} ended${incomplete.length > 0 ? ` (${incomplete.length} rolled to backlog)` : ""}`,
      });
      return jsonResult({ id: row.id, name: row.name, status: "closed", rolledToBacklog: incomplete.length });
    },
  );

  server.registerTool(
    "sprint_review",
    {
      title: "Sprint review summary",
      description: "Completed stories, velocity (sized stories closed), debt delta, top events for a sprint.",
      inputSchema: {
        sprintId: z.string().optional().describe("Defaults to active sprint."),
      },
    },
    async (args) => {
      const { repo, session } = ctx;
      const sprintId = args.sprintId ?? session.activeSprint.id;
      const inSprint = await repo.findStoriesInSprint(sprintId);
      const completed = inSprint.filter((s) => s.status === "done");
      const opened = await repo.countEventsByKindInSprint(sprintId, "debt.opened");
      const closed = await repo.countEventsByKindInSprint(sprintId, "debt.closed");
      const sized = completed.filter((s) => s.size).length;
      return jsonResult({
        sprintId,
        completedStories: completed.length,
        velocitySizedStories: sized,
        debt: { opened, closed, delta: opened - closed },
        stories: completed.map((s) => ({ id: s.id, title: s.title, size: s.size })),
      });
    },
  );
};
