import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  decision,
  developer,
  epic,
  progressEvent,
  project,
  sprint,
  story,
  task,
  techDebt,
} from "./schema.js";
import type {
  Project,
  Developer,
  Sprint,
  Epic,
  Story,
  Task,
  TechDebt,
  Decision,
  ProgressEvent,
} from "./schema.js";
import type { EpicUpdate, HelmRepo, SprintUpdate, StatusCounts, StoryUpdate, TaskUpdate } from "./repo.js";

export function makeSqliteRepo(db: Db): HelmRepo {
  return {
    async findProjectBySlug(slug) {
      const rows = await db.select().from(project).where(eq(project.slug, slug)).limit(1);
      return rows[0] ?? null;
    },
    async findAllProjects() {
      return db.select().from(project).orderBy(project.name);
    },
    async insertProject(row) {
      await db.insert(project).values(row);
    },

    async findDeveloperByHandle(projectId, handle) {
      const rows = await db
        .select()
        .from(developer)
        .where(and(eq(developer.projectId, projectId), eq(developer.handle, handle)))
        .limit(1);
      return rows[0] ?? null;
    },
    async findDeveloperByOidcSub(projectId, oidcSub) {
      const rows = await db
        .select()
        .from(developer)
        .where(and(eq(developer.projectId, projectId), eq(developer.oidcSub, oidcSub)))
        .limit(1);
      return rows[0] ?? null;
    },
    async setDeveloperOidcSub(id, oidcSub) {
      await db.update(developer).set({ oidcSub }).where(eq(developer.id, id));
    },
    async insertDeveloper(row) {
      await db.insert(developer).values(row);
    },
    async touchDeveloper(id, lastSeenAt) {
      await db.update(developer).set({ lastSeenAt }).where(eq(developer.id, id));
    },
    async findDevelopersByProject(projectId) {
      return db.select().from(developer).where(eq(developer.projectId, projectId)).orderBy(desc(developer.lastSeenAt));
    },

    async findActiveSprint(projectId) {
      const rows = await db
        .select()
        .from(sprint)
        .where(and(eq(sprint.projectId, projectId), eq(sprint.status, "active")))
        .limit(1);
      return rows[0] ?? null;
    },
    async findSprintById(id) {
      const rows = await db.select().from(sprint).where(eq(sprint.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async findSprintsByProject(projectId) {
      return db.select().from(sprint).where(eq(sprint.projectId, projectId)).orderBy(desc(sprint.startedAt));
    },
    async insertSprint(row) {
      await db.insert(sprint).values(row);
    },
    async updateSprint(id, updates: SprintUpdate) {
      await db.update(sprint).set(updates).where(eq(sprint.id, id));
    },
    async closeActiveSprints(projectId, endedAt) {
      await db
        .update(sprint)
        .set({ status: "closed", endedAt })
        .where(and(eq(sprint.projectId, projectId), eq(sprint.status, "active")));
    },
    async countSprintsByProject(projectId) {
      const rows = await db.select({ c: sql<number>`count(*)` }).from(sprint).where(eq(sprint.projectId, projectId));
      return rows[0]?.c ?? 0;
    },

    async insertEpic(row) {
      await db.insert(epic).values(row);
    },
    async updateEpic(id, updates: EpicUpdate) {
      await db.update(epic).set(updates).where(eq(epic.id, id));
    },
    async findEpicsByProject(projectId) {
      return db.select().from(epic).where(eq(epic.projectId, projectId)).orderBy(epic.priority);
    },

    async insertStory(row) {
      await db.insert(story).values(row);
    },
    async updateStory(id, updates: StoryUpdate) {
      await db.update(story).set(updates).where(eq(story.id, id));
    },
    async findStoryById(id) {
      const rows = await db.select().from(story).where(eq(story.id, id)).limit(1);
      return rows[0] ?? null;
    },
    async findStoriesInSprint(sprintId) {
      return db.select().from(story).where(eq(story.sprintId, sprintId)).orderBy(story.priority);
    },
    async findStoriesInSprintNotDoneOrDropped(sprintId) {
      return db
        .select()
        .from(story)
        .where(and(eq(story.sprintId, sprintId), ne(story.status, "done"), ne(story.status, "dropped")));
    },
    async rolloverIncompleteStoriesToBacklog(sprintId) {
      const incomplete = await db
        .select({ id: story.id })
        .from(story)
        .where(and(eq(story.sprintId, sprintId), ne(story.status, "done"), ne(story.status, "dropped")));
      if (incomplete.length === 0) return 0;
      await db
        .update(story)
        .set({ sprintId: null, status: "backlog" })
        .where(and(eq(story.sprintId, sprintId), ne(story.status, "done"), ne(story.status, "dropped")));
      return incomplete.length;
    },
    async findBacklogStories(projectId, limit) {
      return db
        .select()
        .from(story)
        .where(and(eq(story.projectId, projectId), isNull(story.sprintId), eq(story.status, "backlog")))
        .orderBy(sql`priority asc, created_at asc`)
        .limit(limit);
    },
    async countStoriesInSprintByStatus(sprintId): Promise<StatusCounts> {
      const rows = await db
        .select({ status: story.status, count: sql<number>`count(*)` })
        .from(story)
        .where(eq(story.sprintId, sprintId))
        .groupBy(story.status);
      const out: StatusCounts = {};
      for (const r of rows) out[r.status] = r.count;
      return out;
    },
    async countBacklog(projectId) {
      const rows = await db
        .select({ c: sql<number>`count(*)` })
        .from(story)
        .where(and(eq(story.projectId, projectId), eq(story.status, "backlog"), isNull(story.sprintId)));
      return rows[0]?.c ?? 0;
    },
    async countDoneStoriesInSprint(sprintId) {
      const rows = await db
        .select({ c: sql<number>`count(*)` })
        .from(story)
        .where(and(eq(story.sprintId, sprintId), eq(story.status, "done")));
      return rows[0]?.c ?? 0;
    },

    async insertTask(row) {
      await db.insert(task).values(row);
    },
    async updateTask(id, updates: TaskUpdate) {
      await db.update(task).set(updates).where(eq(task.id, id));
    },
    async findTasksByProject(projectId, limit) {
      const rows = await db
        .select({
          id: task.id,
          storyId: task.storyId,
          assigneeId: task.assigneeId,
          title: task.title,
          status: task.status,
          blockedBy: task.blockedBy,
          createdAt: task.createdAt,
        })
        .from(task)
        .innerJoin(story, eq(task.storyId, story.id))
        .where(eq(story.projectId, projectId))
        .limit(limit);
      return rows;
    },

    async insertDebt(row) {
      await db.insert(techDebt).values(row);
    },
    async closeDebt(id, closedAt) {
      await db.update(techDebt).set({ closedAt }).where(eq(techDebt.id, id));
    },
    async findOpenDebtByProject(projectId, limit) {
      return db
        .select()
        .from(techDebt)
        .where(and(eq(techDebt.projectId, projectId), isNull(techDebt.closedAt)))
        .orderBy(sql`severity desc, opened_at desc`)
        .limit(limit);
    },
    async findAllDebtByProject(projectId, limit) {
      return db
        .select()
        .from(techDebt)
        .where(eq(techDebt.projectId, projectId))
        .orderBy(sql`closed_at is null desc, severity desc, opened_at desc`)
        .limit(limit);
    },
    async findOpenDebtAtLocation(projectId, location) {
      const rows = await db
        .select()
        .from(techDebt)
        .where(and(eq(techDebt.projectId, projectId), eq(techDebt.location, location), isNull(techDebt.closedAt)))
        .limit(1);
      return rows[0] ?? null;
    },
    async countOpenDebtByProject(projectId) {
      const rows = await db
        .select({ c: sql<number>`count(*)` })
        .from(techDebt)
        .where(and(eq(techDebt.projectId, projectId), isNull(techDebt.closedAt)));
      return rows[0]?.c ?? 0;
    },

    async insertDecision(row) {
      await db.insert(decision).values(row);
    },
    async findDecisionsByProject(projectId, limit) {
      return db
        .select()
        .from(decision)
        .where(eq(decision.projectId, projectId))
        .orderBy(desc(decision.decidedAt))
        .limit(limit);
    },

    async emitEvent(row) {
      await db.insert(progressEvent).values(row);
    },
    async findRecentEvents(projectId, limit) {
      return db
        .select()
        .from(progressEvent)
        .where(eq(progressEvent.projectId, projectId))
        .orderBy(desc(progressEvent.ts))
        .limit(limit);
    },
    async findEventsForSprint(sprintId, limit) {
      return db
        .select()
        .from(progressEvent)
        .where(eq(progressEvent.sprintId, sprintId))
        .orderBy(desc(progressEvent.ts))
        .limit(limit);
    },
    async countEventsByKindInSprint(sprintId, kind) {
      const rows = await db
        .select({ c: sql<number>`count(*)` })
        .from(progressEvent)
        .where(and(eq(progressEvent.sprintId, sprintId), eq(progressEvent.kind, kind)));
      return rows[0]?.c ?? 0;
    },
    async findEventsByDeveloper(projectId, developerId, limit) {
      return db
        .select()
        .from(progressEvent)
        .where(and(eq(progressEvent.projectId, projectId), eq(progressEvent.developerId, developerId)))
        .orderBy(desc(progressEvent.ts))
        .limit(limit);
    },
  };
}
