import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { progressEvent, developer } from "../db/schema.js";
import { emitEvent } from "../events/emit.js";

export const registerProgressTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "log_progress",
    {
      title: "Log a free-form progress event",
      description: "Appends to the project timeline. Use for narrative milestones that don't fit other tools.",
      inputSchema: {
        summary: z.string().min(1),
        refId: z.string().optional(),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "progress.logged",
        refId: args.refId ?? null,
        summary: args.summary,
      });
      return jsonResult({ logged: true, summary: args.summary });
    },
  );

  server.registerTool(
    "who_did_what",
    {
      title: "Developer activity feed",
      description: "Recent events optionally filtered by developer handle.",
      inputSchema: {
        handle: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const limit = args.limit ?? 100;

      const base = db
        .select({
          ts: progressEvent.ts,
          kind: progressEvent.kind,
          summary: progressEvent.summary,
          refId: progressEvent.refId,
          developerId: progressEvent.developerId,
        })
        .from(progressEvent);

      if (args.handle) {
        const dev = await db
          .select()
          .from(developer)
          .where(and(eq(developer.projectId, session.project.id), eq(developer.handle, args.handle)))
          .limit(1);
        const found = dev[0];
        if (!found) return jsonResult({ count: 0, events: [], note: `no developer with handle ${args.handle}` });
        const rows = await base
          .where(and(eq(progressEvent.projectId, session.project.id), eq(progressEvent.developerId, found.id)))
          .orderBy(desc(progressEvent.ts))
          .limit(limit);
        return jsonResult({ count: rows.length, developer: found.handle, events: rows });
      }

      const rows = await base
        .where(eq(progressEvent.projectId, session.project.id))
        .orderBy(desc(progressEvent.ts))
        .limit(limit);
      return jsonResult({ count: rows.length, events: rows });
    },
  );
};
