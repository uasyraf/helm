import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { epic } from "../db/schema.js";
import { newId, now } from "../util/ids.js";
import { emitEvent } from "../events/emit.js";

const EPIC_STATUS = z.enum(["open", "in-progress", "done", "dropped"]);

export const registerEpicTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "open_epic",
    {
      title: "Open a new epic",
      description: "Create a cross-sprint theme. Epics group stories around a shared goal.",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        priority: z.number().int().min(1).max(5).optional(),
        targetSprintId: z.string().optional(),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const id = newId();
      await db.insert(epic).values({
        id,
        projectId: session.project.id,
        title: args.title,
        description: args.description ?? null,
        status: "open",
        priority: args.priority ?? 3,
        targetSprintId: args.targetSprintId ?? null,
        createdAt: now(),
      });
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "epic.opened",
        refId: id,
        summary: `epic: ${args.title}`,
      });
      return jsonResult({ id, title: args.title, status: "open" });
    },
  );

  server.registerTool(
    "update_epic",
    {
      title: "Update an epic",
      description: "Edit title, description, priority, or status.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z.number().int().min(1).max(5).optional(),
        status: EPIC_STATUS.optional(),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const updates: Record<string, unknown> = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.status !== undefined) updates.status = args.status;
      if (Object.keys(updates).length === 0) return jsonResult({ id: args.id, changed: false });

      await db.update(epic).set(updates).where(eq(epic.id, args.id));
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "epic.updated",
        refId: args.id,
        summary: `epic updated: ${Object.keys(updates).join(", ")}`,
      });
      return jsonResult({ id: args.id, changed: true, updates });
    },
  );

  server.registerTool(
    "close_epic",
    {
      title: "Close an epic",
      description: "Marks epic as done (or dropped if specified).",
      inputSchema: {
        id: z.string(),
        dropped: z.boolean().optional().describe("Set true to mark dropped instead of done."),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const status = args.dropped ? "dropped" : "done";
      await db.update(epic).set({ status }).where(eq(epic.id, args.id));
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "epic.closed",
        refId: args.id,
        summary: `epic ${status}`,
      });
      return jsonResult({ id: args.id, status });
    },
  );
};
