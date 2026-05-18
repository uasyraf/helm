import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
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
      const { repo, session } = ctx;
      await emitEvent(repo, {
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
      const { repo, session } = ctx;
      const limit = args.limit ?? 100;

      if (args.handle) {
        const found = await repo.findDeveloperByHandle(session.project.id, args.handle);
        if (!found) return jsonResult({ count: 0, events: [], note: `no developer with handle ${args.handle}` });
        const rows = await repo.findEventsByDeveloper(session.project.id, found.id, limit);
        return jsonResult({ count: rows.length, developer: found.handle, events: rows });
      }
      const rows = await repo.findRecentEvents(session.project.id, limit);
      return jsonResult({ count: rows.length, events: rows });
    },
  );
};
