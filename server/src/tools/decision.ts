import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { decision } from "../db/schema.js";
import { newId, now } from "../util/ids.js";
import { emitEvent } from "../events/emit.js";

const STATUS = z.enum(["proposed", "accepted", "superseded"]);

export const registerDecisionTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "record_decision",
    {
      title: "Record an architectural decision (ADR-lite)",
      description: "Captures context + decision + status. Surfaces on the dashboard timeline.",
      inputSchema: {
        title: z.string().min(1),
        context: z.string().optional(),
        decision: z.string().min(1),
        status: STATUS.optional(),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const id = newId();
      await db.insert(decision).values({
        id,
        projectId: session.project.id,
        title: args.title,
        context: args.context ?? null,
        decision: args.decision,
        status: args.status ?? "accepted",
        decidedAt: now(),
      });
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "decision.recorded",
        refId: id,
        summary: `decision: ${args.title}`,
      });
      return jsonResult({ id, title: args.title, status: args.status ?? "accepted" });
    },
  );
};
