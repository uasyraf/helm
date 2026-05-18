import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  decision,
  developer,
  epic,
  progressEvent,
  project,
  sprint,
  story,
  techDebt,
} from "$helm/db/schema.js";
import type { DashboardDb } from "./db.js";

export async function loadProject(db: DashboardDb, slug: string) {
  const rows = await db.select().from(project).where(eq(project.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function loadActiveSprint(db: DashboardDb, projectId: string) {
  const rows = await db
    .select()
    .from(sprint)
    .where(and(eq(sprint.projectId, projectId), eq(sprint.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadAllSprints(db: DashboardDb, projectId: string) {
  return db.select().from(sprint).where(eq(sprint.projectId, projectId)).orderBy(desc(sprint.startedAt));
}

export async function loadSprintById(db: DashboardDb, sprintId: string) {
  const rows = await db.select().from(sprint).where(eq(sprint.id, sprintId)).limit(1);
  return rows[0] ?? null;
}

export async function loadStoriesInSprint(db: DashboardDb, sprintId: string) {
  return db.select().from(story).where(eq(story.sprintId, sprintId)).orderBy(story.priority);
}

export async function loadOpenDebt(db: DashboardDb, projectId: string, limit = 100) {
  return db
    .select()
    .from(techDebt)
    .where(and(eq(techDebt.projectId, projectId), isNull(techDebt.closedAt)))
    .orderBy(sql`severity desc, opened_at desc`)
    .limit(limit);
}

export async function loadAllDebt(db: DashboardDb, projectId: string, limit = 500) {
  return db
    .select()
    .from(techDebt)
    .where(eq(techDebt.projectId, projectId))
    .orderBy(sql`closed_at is null desc, severity desc, opened_at desc`)
    .limit(limit);
}

export async function loadRecentEvents(db: DashboardDb, projectId: string, limit = 30) {
  return db
    .select()
    .from(progressEvent)
    .where(eq(progressEvent.projectId, projectId))
    .orderBy(desc(progressEvent.ts))
    .limit(limit);
}

export interface SprintMetric {
  sprintId: string;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  storiesTotal: number;
  storiesDone: number;
  debtOpened: number;
  debtClosed: number;
  debtDelta: number;
}

export async function loadSprintMetrics(db: DashboardDb, projectId: string): Promise<SprintMetric[]> {
  const sprints = await loadAllSprints(db, projectId);
  const out: SprintMetric[] = [];
  for (const s of sprints) {
    out.push(await computeSprintMetric(db, s));
  }
  return out;
}

export async function computeSprintMetric(db: DashboardDb, s: { id: string; name: string; status: string; startedAt: string; endedAt: string | null }): Promise<SprintMetric> {
  const total = await db
    .select({ c: sql<number>`count(*)` })
    .from(story)
    .where(eq(story.sprintId, s.id));
  const done = await db
    .select({ c: sql<number>`count(*)` })
    .from(story)
    .where(and(eq(story.sprintId, s.id), eq(story.status, "done")));
  const opened = await db
    .select({ c: sql<number>`count(*)` })
    .from(progressEvent)
    .where(and(eq(progressEvent.sprintId, s.id), eq(progressEvent.kind, "debt.opened")));
  const closed = await db
    .select({ c: sql<number>`count(*)` })
    .from(progressEvent)
    .where(and(eq(progressEvent.sprintId, s.id), eq(progressEvent.kind, "debt.closed")));

  const o = opened[0]?.c ?? 0;
  const c = closed[0]?.c ?? 0;
  return {
    sprintId: s.id,
    name: s.name,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    storiesTotal: total[0]?.c ?? 0,
    storiesDone: done[0]?.c ?? 0,
    debtOpened: o,
    debtClosed: c,
    debtDelta: o - c,
  };
}

export async function loadEventsForSprint(db: DashboardDb, sprintId: string, limit = 100) {
  return db
    .select()
    .from(progressEvent)
    .where(eq(progressEvent.sprintId, sprintId))
    .orderBy(desc(progressEvent.ts))
    .limit(limit);
}

export async function loadEpics(db: DashboardDb, projectId: string) {
  return db.select().from(epic).where(eq(epic.projectId, projectId)).orderBy(epic.priority);
}

export async function loadDevelopers(db: DashboardDb, projectId: string) {
  return db.select().from(developer).where(eq(developer.projectId, projectId)).orderBy(desc(developer.lastSeenAt));
}

export async function loadDecisions(db: DashboardDb, projectId: string, limit = 50) {
  return db.select().from(decision).where(eq(decision.projectId, projectId)).orderBy(desc(decision.decidedAt)).limit(limit);
}
