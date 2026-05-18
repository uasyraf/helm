import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { techDebt } from "../db/schema.js";
import { newId, now } from "../util/ids.js";
import { emitEvent } from "../events/emit.js";

const SEVERITY = z.enum(["low", "med", "high", "critical"]);

export const registerDebtTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "log_debt",
    {
      title: "Log a tech debt item",
      description: "Records a debt item. Auto-attributed to active sprint via the progress event.",
      inputSchema: {
        title: z.string().min(1),
        description: z.string().optional(),
        severity: SEVERITY.optional(),
        location: z.string().optional().describe("file:line or symbol path"),
        expiresAt: z.string().optional().describe("ISO date when this should be paid down"),
        linkedStoryId: z.string().optional(),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const id = newId();
      await db.insert(techDebt).values({
        id,
        projectId: session.project.id,
        title: args.title,
        description: args.description ?? null,
        severity: args.severity ?? "med",
        location: args.location ?? null,
        ownerId: session.developer.id,
        expiresAt: args.expiresAt ?? null,
        openedAt: now(),
        closedAt: null,
        linkedStoryId: args.linkedStoryId ?? null,
      });
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "debt.opened",
        refId: id,
        summary: `debt: ${args.title}${args.location ? ` @ ${args.location}` : ""}`,
      });
      return jsonResult({ id, title: args.title, severity: args.severity ?? "med" });
    },
  );

  server.registerTool(
    "close_debt",
    {
      title: "Close a debt item",
      description: "Marks debt paid down. Closes during the active sprint count toward the killer metric.",
      inputSchema: { id: z.string() },
    },
    async (args) => {
      const { db, session } = ctx;
      await db.update(techDebt).set({ closedAt: now() }).where(eq(techDebt.id, args.id));
      await emitEvent(db, {
        projectId: session.project.id,
        developerId: session.developer.id,
        sprintId: session.activeSprint.id,
        kind: "debt.closed",
        refId: args.id,
        summary: "debt closed",
      });
      return jsonResult({ id: args.id, closed: true });
    },
  );

  server.registerTool(
    "list_debt",
    {
      title: "List debt items",
      description: "Open debt by default; pass includeClosed=true for the full history.",
      inputSchema: {
        includeClosed: z.boolean().optional(),
        limit: z.number().int().positive().max(500).optional(),
      },
    },
    async (args) => {
      const { db, session } = ctx;
      const limit = args.limit ?? 100;
      const filter = args.includeClosed
        ? eq(techDebt.projectId, session.project.id)
        : and(eq(techDebt.projectId, session.project.id), isNull(techDebt.closedAt));
      const rows = await db.select().from(techDebt).where(filter).orderBy(sql`severity desc, opened_at desc`).limit(limit);
      return jsonResult({
        count: rows.length,
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          severity: r.severity,
          location: r.location,
          openedAt: r.openedAt,
          closedAt: r.closedAt,
          expiresAt: r.expiresAt,
        })),
      });
    },
  );
};
