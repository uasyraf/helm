import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { task } from "../db/schema.js";
import { newId, now } from "../util/ids.js";
import { emitEvent } from "../events/emit.js";

const TASK_STATUS = z.enum(["todo", "doing", "done"]);

export const registerTaskTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "open_task",
    {
      title: "Open a task under a story",
      description: "Implementation step inside a story. Not a substitute for TodoWrite.",
      inputSchema: {
        storyId: z.string(),
        title: z.string().min(1),
        assigneeId: z.string().optional(),
        blockedBy: z.string().optional().describe("ID of a blocking task, if any."),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const id = newId();
      await db.insert(task).values({
        id,
        storyId: args.storyId,
        assigneeId: args.assigneeId ?? null,
        title: args.title,
        status: "todo",
        blockedBy: args.blockedBy ?? null,
        createdAt: now(),
      });
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "task.opened",
        refId: id,
        summary: `task: ${args.title}`,
      });
      return jsonResult({ id, title: args.title, status: "todo" });
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "Update a task",
      description: "Edit title, status, assignee, or blocked_by.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        status: TASK_STATUS.optional(),
        assigneeId: z.string().optional(),
        blockedBy: z.string().nullable().optional(),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const updates: Record<string, unknown> = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.status !== undefined) updates.status = args.status;
      if (args.assigneeId !== undefined) updates.assigneeId = args.assigneeId;
      if (args.blockedBy !== undefined) updates.blockedBy = args.blockedBy;
      if (Object.keys(updates).length === 0) return jsonResult({ id: args.id, changed: false });

      await db.update(task).set(updates).where(eq(task.id, args.id));
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "task.updated",
        refId: args.id,
        summary: `task updated: ${Object.keys(updates).join(", ")}`,
      });
      return jsonResult({ id: args.id, changed: true, updates });
    },
  );

  server.registerTool(
    "close_task",
    {
      title: "Close a task",
      description: "Marks a task done.",
      inputSchema: { id: z.string() },
    },
    async (args) => {
      const { db, session } = ctx;
      await db.update(task).set({ status: "done" }).where(eq(task.id, args.id));
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "task.closed",
        refId: args.id,
        summary: "task done",
      });
      return jsonResult({ id: args.id, status: "done" });
    },
  );
};
