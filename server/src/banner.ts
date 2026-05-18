import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { openProjectDb } from "./db/open-project.js";
import { bootstrapSession, type SessionContext } from "./project/bootstrap.js";
import { story, techDebt, progressEvent } from "./db/schema.js";

export async function renderBanner(cwd: string = process.cwd()): Promise<string> {
  const { handle } = await openProjectDb(cwd);
  try {
    const session = await bootstrapSession(handle.db, cwd);
    return await formatBanner(handle.db, session);
  } finally {
    handle.client.close();
  }
}

async function formatBanner(db: Db, session: SessionContext): Promise<string> {
  const sprintRow = session.activeSprint;
  const lengthDays = session.project.sprintLengthDays;
  const day = sprintDayNumber(sprintRow.startedAt);

  const inSprint = await db
    .select({ count: sql<number>`count(*)` })
    .from(story)
    .where(eq(story.sprintId, sprintRow.id));
  const doneInSprint = await db
    .select({ count: sql<number>`count(*)` })
    .from(story)
    .where(and(eq(story.sprintId, sprintRow.id), eq(story.status, "done")));

  const openDebt = await db
    .select({ count: sql<number>`count(*)` })
    .from(techDebt)
    .where(and(eq(techDebt.projectId, session.project.id), isNull(techDebt.closedAt)));

  const opened = await db
    .select({ count: sql<number>`count(*)` })
    .from(progressEvent)
    .where(and(eq(progressEvent.sprintId, sprintRow.id), eq(progressEvent.kind, "debt.opened")));
  const closed = await db
    .select({ count: sql<number>`count(*)` })
    .from(progressEvent)
    .where(and(eq(progressEvent.sprintId, sprintRow.id), eq(progressEvent.kind, "debt.closed")));

  const total = inSprint[0]?.count ?? 0;
  const done = doneInSprint[0]?.count ?? 0;
  const debt = openDebt[0]?.count ?? 0;
  const delta = (opened[0]?.count ?? 0) - (closed[0]?.count ?? 0);
  const sign = delta > 0 ? `+${delta}` : `${delta}`;

  return `[helm] ${sprintRow.name} (d${day}/${lengthDays}) | stories: ${done}/${total} done | debt: ${debt} (Δ${sign})`;
}

function sprintDayNumber(startedAt: string): number {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return 1;
  const diffMs = Date.now() - start;
  return Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
}
