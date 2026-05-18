import { and, eq, isNull, sql } from "drizzle-orm";
import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";
import { story, techDebt, progressEvent } from "../db/schema.js";

export const registerStatusTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "get_status",
    {
      title: "Project status",
      description: "Active sprint, in-flight stories, open debt counts, killer metric (debt delta this sprint).",
      inputSchema: {},
    },
    async () => {
      const { db, session } = ctx;
      const sprintId = session.activeSprint.id;
      const projectId = session.project.id;

      const inSprint = await db
        .select({ status: story.status, count: sql<number>`count(*)` })
        .from(story)
        .where(eq(story.sprintId, sprintId))
        .groupBy(story.status);

      const backlogCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(story)
        .where(and(eq(story.status, "backlog"), isNull(story.sprintId)));

      const openDebt = await db
        .select({ count: sql<number>`count(*)` })
        .from(techDebt)
        .where(and(eq(techDebt.projectId, projectId), isNull(techDebt.closedAt)));

      const sprintDebtOpened = await db
        .select({ count: sql<number>`count(*)` })
        .from(progressEvent)
        .where(and(eq(progressEvent.sprintId, sprintId), eq(progressEvent.kind, "debt.opened")));

      const sprintDebtClosed = await db
        .select({ count: sql<number>`count(*)` })
        .from(progressEvent)
        .where(and(eq(progressEvent.sprintId, sprintId), eq(progressEvent.kind, "debt.closed")));

      const opened = sprintDebtOpened[0]?.count ?? 0;
      const closed = sprintDebtClosed[0]?.count ?? 0;

      return jsonResult({
        project: { slug: session.project.slug, name: session.project.name },
        sprint: {
          id: session.activeSprint.id,
          name: session.activeSprint.name,
          goal: session.activeSprint.goal,
          startedAt: session.activeSprint.startedAt,
          status: session.activeSprint.status,
        },
        stories: {
          inSprintByStatus: Object.fromEntries(inSprint.map((r) => [r.status, r.count])),
          backlogCount: backlogCount[0]?.count ?? 0,
        },
        debt: {
          open: openDebt[0]?.count ?? 0,
          openedThisSprint: opened,
          closedThisSprint: closed,
          delta: opened - closed,
        },
        warnings: session.warnings,
      });
    },
  );
};