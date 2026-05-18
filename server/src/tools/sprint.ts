import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { sprint, story, progressEvent } from "../db/schema.js";
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
      const { db, session } = ctx;
      await db
        .update(sprint)
        .set({ status: "closed", endedAt: now() })
        .where(and(eq(sprint.projectId, session.project.id), eq(sprint.status, "active")));

      const count = await db
        .select({ c: sql<number>`count(*)` })
        .from(sprint)
        .where(eq(sprint.projectId, session.project.id));
      const seq = (count[0]?.c ?? 0) + 1;

      const id = newId();
      const name = args.name ?? `sprint-${seq}`;
      await db.insert(sprint).values({
        id,
        projectId: session.project.id,
        name,
        goal: args.goal ?? null,
        startedAt: now(),
        endedAt: null,
        status: "active",
        wipLimit: args.wipLimit ?? null,
      });

      await emitEvent(db, {
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
      const { db, session } = ctx;
      const active = await db
        .select()
        .from(sprint)
        .where(and(eq(sprint.projectId, session.project.id), eq(sprint.status, "active")))
        .limit(1);
      const row = active[0];
      if (!row) {
        return jsonResult({ error: "no active sprint" });
      }

      const incomplete = await db
        .select({ id: story.id, title: story.title })
        .from(story)
        .where(and(eq(story.sprintId, row.id), ne(story.status, "done"), ne(story.status, "dropped")));

      if (incomplete.length > 0) {
        await db
          .update(story)
          .set({ sprintId: null, status: "backlog" })
          .where(and(eq(story.sprintId, row.id), ne(story.status, "done"), ne(story.status, "dropped")));

        for (const s of incomplete) {
          await emitEvent(db, {
            projectId: session.project.id,
            developerId: session.developer.id,
            sprintId: row.id,
            kind: "story.moved",
            refId: s.id,
            summary: `${s.title} → backlog (sprint rollover)`,
          });
        }
      }

      await db.update(sprint).set({ status: "closed", endedAt: now() }).where(eq(sprint.id, row.id));
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: row.id,
        kind: "sprint.ended",
        refId: row.id,
        summary: `${row.name} ended${incomplete.length > 0 ? ` (${incomplete.length} rolled to backlog)` : ""}`,
      });
      return jsonResult({
        id: row.id,
        name: row.name,
        status: "closed",
        rolledToBacklog: incomplete.length,
      });
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
      const { db, session } = ctx;
      const sprintId = args.sprintId ?? session.activeSprint.id;

      const completed = await db
        .select()
        .from(story)
        .where(and(eq(story.sprintId, sprintId), eq(story.status, "done")));

      const opened = await db
        .select({ c: sql<number>`count(*)` })
        .from(progressEvent)
        .where(and(eq(progressEvent.sprintId, sprintId), eq(progressEvent.kind, "debt.opened")));
      const closed = await db
        .select({ c: sql<number>`count(*)` })
        .from(progressEvent)
        .where(and(eq(progressEvent.sprintId, sprintId), eq(progressEvent.kind, "debt.closed")));

      const sized = completed.filter((s) => s.size).length;
      return jsonResult({
        sprintId,
        completedStories: completed.length,
        velocitySizedStories: sized,
        debt: {
          opened: opened[0]?.c ?? 0,
          closed: closed[0]?.c ?? 0,
          delta: (opened[0]?.c ?? 0) - (closed[0]?.c ?? 0),
        },
        stories: completed.map((s) => ({ id: s.id, title: s.title, size: s.size })),
      });
    },
  );
};
