import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDb } from "./pg-client.js";
import {
  decision,
  developer,
  epic,
  progressEvent,
  project,
  projectMember,
  sprint,
  story,
  task,
  techDebt,
} from "./schema-pg.js";
import type {
  Project,
  ProjectMember,
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
import type { schema as pgSchemaShape } from "./schema-pg.js";

// Cast through one driver type so method signatures unify; runtime is identical
// for both node-postgres and pglite Drizzle backends.
type AnyPgDb = NodePgDatabase<typeof pgSchemaShape>;

export function makePgRepo(db: PgDb): HelmRepo {
  const pg = db as unknown as AnyPgDb;
  return {
    async findProjectBySlug(slug) {
      const rows = await pg.select().from(project).where(eq(project.slug, slug)).limit(1);
      return (rows[0] as Project | undefined) ?? null;
    },
    async findAllProjects() {
      const rows = await pg.select().from(project).orderBy(project.name);
      return rows as Project[];
    },
    async insertProject(row) {
      await pg.insert(project).values(row);
    },
    async insertProjectMember(row) {
      await pg.insert(projectMember).values(row);
    },
    async findProjectMember(projectId, userSub) {
      const rows = await pg
        .select()
        .from(projectMember)
        .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userSub, userSub)))
        .limit(1);
      return (rows[0] as ProjectMember | undefined) ?? null;
    },
    async findProjectMembersByUserSub(userSub) {
      const rows = await pg
        .select()
        .from(projectMember)
        .where(eq(projectMember.userSub, userSub));
      return rows as ProjectMember[];
    },

    async findDeveloperByHandle(projectId, handle) {
      const rows = await pg
        .select()
        .from(developer)
        .where(and(eq(developer.projectId, projectId), eq(developer.handle, handle)))
        .limit(1);
      return (rows[0] as Developer | undefined) ?? null;
    },
    async findDeveloperByOidcSub(projectId, oidcSub) {
      const rows = await pg
        .select()
        .from(developer)
        .where(and(eq(developer.projectId, projectId), eq(developer.oidcSub, oidcSub)))
        .limit(1);
      return (rows[0] as Developer | undefined) ?? null;
    },
    async setDeveloperOidcSub(id, oidcSub) {
      await pg.update(developer).set({ oidcSub }).where(eq(developer.id, id));
    },
    async insertDeveloper(row) {
      await pg.insert(developer).values(row);
    },
    async touchDeveloper(id, lastSeenAt) {
      await pg.update(developer).set({ lastSeenAt }).where(eq(developer.id, id));
    },
    async findDevelopersByProject(projectId) {
      const rows = await pg
        .select()
        .from(developer)
        .where(eq(developer.projectId, projectId))
        .orderBy(desc(developer.lastSeenAt));
      return rows as Developer[];
    },

    async findActiveSprint(projectId) {
      const rows = await pg
        .select()
        .from(sprint)
        .where(and(eq(sprint.projectId, projectId), eq(sprint.status, "active")))
        .limit(1);
      return (rows[0] as Sprint | undefined) ?? null;
    },
    async findSprintById(id) {
      const rows = await pg.select().from(sprint).where(eq(sprint.id, id)).limit(1);
      return (rows[0] as Sprint | undefined) ?? null;
    },
    async findSprintsByProject(projectId) {
      const rows = await pg
        .select()
        .from(sprint)
        .where(eq(sprint.projectId, projectId))
        .orderBy(desc(sprint.startedAt));
      return rows as Sprint[];
    },
    async insertSprint(row) {
      await pg.insert(sprint).values(row);
    },
    async updateSprint(id, updates: SprintUpdate) {
      await pg.update(sprint).set(updates).where(eq(sprint.id, id));
    },
    async closeActiveSprints(projectId, endedAt) {
      await pg
        .update(sprint)
        .set({ status: "closed", endedAt })
        .where(and(eq(sprint.projectId, projectId), eq(sprint.status, "active")));
    },
    async countSprintsByProject(projectId) {
      const rows = await pg.select({ c: sql<number>`count(*)::int` }).from(sprint).where(eq(sprint.projectId, projectId));
      return Number(rows[0]?.c ?? 0);
    },

    async insertEpic(row) {
      await pg.insert(epic).values(row);
    },
    async updateEpic(id, updates: EpicUpdate) {
      await pg.update(epic).set(updates).where(eq(epic.id, id));
    },
    async findEpicsByProject(projectId) {
      const rows = await pg.select().from(epic).where(eq(epic.projectId, projectId)).orderBy(epic.priority);
      return rows as Epic[];
    },

    async insertStory(row) {
      await pg.insert(story).values(row);
    },
    async updateStory(id, updates: StoryUpdate) {
      await pg.update(story).set(updates).where(eq(story.id, id));
    },
    async findStoryById(id) {
      const rows = await pg.select().from(story).where(eq(story.id, id)).limit(1);
      return (rows[0] as Story | undefined) ?? null;
    },
    async findStoriesInSprint(sprintId) {
      const rows = await pg.select().from(story).where(eq(story.sprintId, sprintId)).orderBy(story.priority);
      return rows as Story[];
    },
    async findStoriesInSprintNotDoneOrDropped(sprintId) {
      const rows = await pg
        .select()
        .from(story)
        .where(and(eq(story.sprintId, sprintId), ne(story.status, "done"), ne(story.status, "dropped")));
      return rows as Story[];
    },
    async rolloverIncompleteStoriesToBacklog(sprintId) {
      const incomplete = await pg
        .select({ id: story.id })
        .from(story)
        .where(and(eq(story.sprintId, sprintId), ne(story.status, "done"), ne(story.status, "dropped")));
      if (incomplete.length === 0) return 0;
      await pg
        .update(story)
        .set({ sprintId: null, status: "backlog" })
        .where(and(eq(story.sprintId, sprintId), ne(story.status, "done"), ne(story.status, "dropped")));
      return incomplete.length;
    },
    async findBacklogStories(projectId, limit) {
      const rows = await pg
        .select()
        .from(story)
        .where(and(eq(story.projectId, projectId), isNull(story.sprintId), eq(story.status, "backlog")))
        .orderBy(sql`priority asc, created_at asc`)
        .limit(limit);
      return rows as Story[];
    },
    async countStoriesInSprintByStatus(sprintId): Promise<StatusCounts> {
      const rows = await pg
        .select({ status: story.status, count: sql<number>`count(*)::int` })
        .from(story)
        .where(eq(story.sprintId, sprintId))
        .groupBy(story.status);
      const out: StatusCounts = {};
      for (const r of rows) out[r.status] = Number(r.count);
      return out;
    },
    async countBacklog(projectId) {
      const rows = await pg
        .select({ c: sql<number>`count(*)::int` })
        .from(story)
        .where(and(eq(story.projectId, projectId), eq(story.status, "backlog"), isNull(story.sprintId)));
      return Number(rows[0]?.c ?? 0);
    },
    async countDoneStoriesInSprint(sprintId) {
      const rows = await pg
        .select({ c: sql<number>`count(*)::int` })
        .from(story)
        .where(and(eq(story.sprintId, sprintId), eq(story.status, "done")));
      return Number(rows[0]?.c ?? 0);
    },

    async insertTask(row) {
      await pg.insert(task).values(row);
    },
    async updateTask(id, updates: TaskUpdate) {
      await pg.update(task).set(updates).where(eq(task.id, id));
    },
    async findTasksByProject(projectId, limit) {
      const rows = await pg
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
      return rows as Task[];
    },

    async insertDebt(row) {
      await pg.insert(techDebt).values(row);
    },
    async closeDebt(id, closedAt) {
      await pg.update(techDebt).set({ closedAt }).where(eq(techDebt.id, id));
    },
    async findOpenDebtByProject(projectId, limit) {
      const rows = await pg
        .select()
        .from(techDebt)
        .where(and(eq(techDebt.projectId, projectId), isNull(techDebt.closedAt)))
        .orderBy(sql`severity desc, opened_at desc`)
        .limit(limit);
      return rows as TechDebt[];
    },
    async findAllDebtByProject(projectId, limit) {
      const rows = await pg
        .select()
        .from(techDebt)
        .where(eq(techDebt.projectId, projectId))
        .orderBy(sql`closed_at is null desc, severity desc, opened_at desc`)
        .limit(limit);
      return rows as TechDebt[];
    },
    async findOpenDebtAtLocation(projectId, location) {
      const rows = await pg
        .select()
        .from(techDebt)
        .where(and(eq(techDebt.projectId, projectId), eq(techDebt.location, location), isNull(techDebt.closedAt)))
        .limit(1);
      return (rows[0] as TechDebt | undefined) ?? null;
    },
    async countOpenDebtByProject(projectId) {
      const rows = await pg
        .select({ c: sql<number>`count(*)::int` })
        .from(techDebt)
        .where(and(eq(techDebt.projectId, projectId), isNull(techDebt.closedAt)));
      return Number(rows[0]?.c ?? 0);
    },

    async insertDecision(row) {
      await pg.insert(decision).values(row);
    },
    async findDecisionsByProject(projectId, limit) {
      const rows = await pg
        .select()
        .from(decision)
        .where(eq(decision.projectId, projectId))
        .orderBy(desc(decision.decidedAt))
        .limit(limit);
      return rows as Decision[];
    },

    async emitEvent(row) {
      await pg.insert(progressEvent).values(row);
    },
    async findRecentEvents(projectId, limit) {
      const rows = await pg
        .select()
        .from(progressEvent)
        .where(eq(progressEvent.projectId, projectId))
        .orderBy(desc(progressEvent.ts))
        .limit(limit);
      return rows as ProgressEvent[];
    },
    async findEventsForSprint(sprintId, limit) {
      const rows = await pg
        .select()
        .from(progressEvent)
        .where(eq(progressEvent.sprintId, sprintId))
        .orderBy(desc(progressEvent.ts))
        .limit(limit);
      return rows as ProgressEvent[];
    },
    async countEventsByKindInSprint(sprintId, kind) {
      const rows = await pg
        .select({ c: sql<number>`count(*)::int` })
        .from(progressEvent)
        .where(and(eq(progressEvent.sprintId, sprintId), eq(progressEvent.kind, kind)));
      return Number(rows[0]?.c ?? 0);
    },
    async findEventsByDeveloper(projectId, developerId, limit) {
      const rows = await pg
        .select()
        .from(progressEvent)
        .where(and(eq(progressEvent.projectId, projectId), eq(progressEvent.developerId, developerId)))
        .orderBy(desc(progressEvent.ts))
        .limit(limit);
      return rows as ProgressEvent[];
    },
  };
}
