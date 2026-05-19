import { Hono } from "hono";
import { z } from "zod";
import type { RestEnv } from "./context.js";
import { httpErrors } from "./errors.js";
import { newId, now } from "../../util/ids.js";
import { loadProjectAndActor } from "./project-loader.js";
import { emitEvent } from "../../events/emit.js";
import type { EpicUpdate, StoryUpdate, TaskUpdate, SprintUpdate } from "../../db/repo.js";

const STORY_STATUS = z.enum(["backlog", "todo", "doing", "review", "done", "dropped"]);
const TASK_STATUS = z.enum(["todo", "doing", "done", "blocked"]);
const SIZE = z.enum(["XS", "S", "M", "L", "XL", "XXL"]);
const SEVERITY = z.enum(["low", "med", "high", "crit"]);
const PRIORITY = z.number().int().min(1).max(5);

const StoryCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  acceptance: z.string().optional(),
  epicId: z.string().optional(),
  sprintId: z.string().optional(),
  size: SIZE.optional(),
  priority: PRIORITY.optional(),
  assigneeId: z.string().optional(),
});

const StoryPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  acceptance: z.string().optional(),
  status: STORY_STATUS.optional(),
  size: SIZE.optional(),
  priority: PRIORITY.optional(),
  assigneeId: z.string().optional(),
  epicId: z.string().optional(),
});

const StoryMoveSchema = z.object({ sprintId: z.string().nullable() });
const StoryCloseSchema = z.object({ dropped: z.boolean().optional() });

const EpicCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: PRIORITY.optional(),
  targetSprintId: z.string().optional(),
});

const EpicPatchSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  priority: PRIORITY.optional(),
  status: z.enum(["open", "in_progress", "done", "dropped"]).optional(),
  targetSprintId: z.string().nullable().optional(),
});

const TaskCreateSchema = z.object({
  storyId: z.string(),
  title: z.string().min(1),
  assigneeId: z.string().optional(),
});

const TaskPatchSchema = z.object({
  title: z.string().optional(),
  status: TASK_STATUS.optional(),
  assigneeId: z.string().optional(),
  blockedBy: z.string().nullable().optional(),
});

const DebtCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: SEVERITY.optional(),
  location: z.string().optional(),
  expiresAt: z.string().optional(),
  linkedStoryId: z.string().optional(),
});

const DecisionCreateSchema = z.object({
  title: z.string().min(1),
  context: z.string().optional(),
  decision: z.string().min(1),
  status: z.enum(["proposed", "accepted", "superseded", "rejected"]).optional(),
});

const SprintStartSchema = z.object({
  name: z.string().optional(),
  goal: z.string().optional(),
  wipLimit: z.number().int().positive().optional(),
});

const SprintPatchSchema = z.object({
  name: z.string().optional(),
  goal: z.string().optional(),
  wipLimit: z.number().int().positive().nullable().optional(),
});

function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw httpErrors.badRequest("invalid request body", result.error.format());
  return result.data;
}

export function buildProjectRoutes(): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  app.get("/", async (c) => {
    const repo = c.get("repo");
    const actor = c.get("actor");
    const all = await repo.findAllProjects();
    const allowed = actor.allowedProjects;
    const visible = allowed === "all" ? all : all.filter((p) => allowed.has(p.slug));
    return c.json({ projects: visible.map((p) => ({ slug: p.slug, name: p.name, createdAt: p.createdAt })) });
  });

  const ProjectCreateSchema = z.object({
    slug: z.string().regex(/^[a-z0-9._-]+$/),
    name: z.string().min(1).optional(),
    gitRemote: z.string().optional(),
    sprintLengthDays: z.number().int().positive().optional(),
  });

  app.post("/", async (c) => {
    const actor = c.get("actor");
    if (!actor.isAdmin) throw httpErrors.forbidden("admin role required to create projects");
    const body = parseBody(ProjectCreateSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const existing = await repo.findProjectBySlug(body.slug);
    if (existing) throw httpErrors.conflict(`project '${body.slug}' already exists`);
    const row = {
      id: newId(),
      slug: body.slug,
      name: body.name ?? body.slug,
      gitRemote: body.gitRemote ?? null,
      dod: null,
      sprintLengthDays: body.sprintLengthDays ?? 14,
      wipEnabled: false,
      estimationEnabled: true,
      createdAt: now(),
    };
    await repo.insertProject(row);
    return c.json(row, 201);
  });

  const scoped = new Hono<RestEnv>();
  scoped.use("*", loadProjectAndActor);

  scoped.get("/", async (c) => c.json(c.get("project")));

  scoped.get("/status", async (c) => {
    const repo = c.get("repo");
    const project = c.get("project");
    const active = await repo.findActiveSprint(project.id);
    if (!active) return c.json({ project: { slug: project.slug, name: project.name }, sprint: null });
    const inSprintByStatus = await repo.countStoriesInSprintByStatus(active.id);
    const backlogCount = await repo.countBacklog(project.id);
    const openDebt = await repo.countOpenDebtByProject(project.id);
    const opened = await repo.countEventsByKindInSprint(active.id, "debt.opened");
    const closed = await repo.countEventsByKindInSprint(active.id, "debt.closed");
    return c.json({
      project: { slug: project.slug, name: project.name },
      sprint: { id: active.id, name: active.name, goal: active.goal, startedAt: active.startedAt, status: active.status },
      stories: { inSprintByStatus, backlogCount },
      debt: { open: openDebt, openedThisSprint: opened, closedThisSprint: closed, delta: opened - closed },
    });
  });

  scoped.get("/sprints", async (c) => {
    const sprints = await c.get("repo").findSprintsByProject(c.get("project").id);
    return c.json({ sprints });
  });

  scoped.get("/sprints/active", async (c) => {
    const active = await c.get("repo").findActiveSprint(c.get("project").id);
    if (!active) throw httpErrors.notFound("no active sprint");
    return c.json(active);
  });

  scoped.post("/sprints/start", async (c) => {
    const body = parseBody(SprintStartSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    await repo.closeActiveSprints(project.id, now());
    const count = await repo.countSprintsByProject(project.id);
    const sprint = {
      id: newId(),
      projectId: project.id,
      name: body.name ?? `sprint-${count + 1}`,
      goal: body.goal ?? null,
      startedAt: now(),
      endedAt: null,
      status: "active" as const,
      wipLimit: body.wipLimit ?? null,
    };
    await repo.insertSprint(sprint);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: sprint.id,
      kind: "sprint.started",
      refId: sprint.id,
      summary: `${sprint.name} started`,
    });
    return c.json(sprint, 201);
  });

  scoped.post("/sprints/:id/end", async (c) => {
    const id = c.req.param("id");
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const sprint = await repo.findSprintById(id);
    if (!sprint || sprint.projectId !== project.id) throw httpErrors.notFound("sprint not found");
    const update: SprintUpdate = { status: "ended", endedAt: now() };
    await repo.updateSprint(id, update);
    const rolled = await repo.rolloverIncompleteStoriesToBacklog(id);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: id,
      kind: "sprint.ended",
      refId: id,
      summary: `${sprint.name} ended (${rolled} stories rolled to backlog)`,
    });
    return c.json({ id, status: "ended", rolledToBacklog: rolled });
  });

  scoped.get("/sprints/:id", async (c) => {
    const id = c.req.param("id");
    const repo = c.get("repo");
    const project = c.get("project");
    const sprint = await repo.findSprintById(id);
    if (!sprint || sprint.projectId !== project.id) throw httpErrors.notFound("sprint not found");
    return c.json(sprint);
  });

  scoped.get("/sprints/:id/stories", async (c) => {
    const id = c.req.param("id");
    const repo = c.get("repo");
    const project = c.get("project");
    const sprint = await repo.findSprintById(id);
    if (!sprint || sprint.projectId !== project.id) throw httpErrors.notFound("sprint not found");
    const rows = await repo.findStoriesInSprint(id);
    return c.json({ count: rows.length, stories: rows });
  });

  scoped.get("/sprints/:id/events", async (c) => {
    const id = c.req.param("id");
    const repo = c.get("repo");
    const project = c.get("project");
    const sprint = await repo.findSprintById(id);
    if (!sprint || sprint.projectId !== project.id) throw httpErrors.notFound("sprint not found");
    const limit = Number(c.req.query("limit") ?? "100");
    const events = await repo.findEventsForSprint(id, limit);
    return c.json({ count: events.length, events });
  });

  scoped.get("/sprints/:id/counts", async (c) => {
    const id = c.req.param("id");
    const repo = c.get("repo");
    const project = c.get("project");
    const sprint = await repo.findSprintById(id);
    if (!sprint || sprint.projectId !== project.id) throw httpErrors.notFound("sprint not found");
    const byStatus = await repo.countStoriesInSprintByStatus(id);
    const opened = await repo.countEventsByKindInSprint(id, "debt.opened");
    const closed = await repo.countEventsByKindInSprint(id, "debt.closed");
    return c.json({ byStatus, debtOpened: opened, debtClosed: closed });
  });

  scoped.get("/developers", async (c) => {
    const devs = await c.get("repo").findDevelopersByProject(c.get("project").id);
    return c.json({ count: devs.length, developers: devs });
  });

  scoped.get("/sprints/:id/review", async (c) => {
    const id = c.req.param("id");
    const repo = c.get("repo");
    const project = c.get("project");
    const sprint = await repo.findSprintById(id);
    if (!sprint || sprint.projectId !== project.id) throw httpErrors.notFound("sprint not found");
    const counts = await repo.countStoriesInSprintByStatus(id);
    const opened = await repo.countEventsByKindInSprint(id, "debt.opened");
    const closed = await repo.countEventsByKindInSprint(id, "debt.closed");
    const done = await repo.countDoneStoriesInSprint(id);
    return c.json({
      sprint: { id: sprint.id, name: sprint.name, status: sprint.status, startedAt: sprint.startedAt, endedAt: sprint.endedAt },
      stories: { byStatus: counts, done },
      debt: { openedDuringSprint: opened, closedDuringSprint: closed, delta: opened - closed },
    });
  });

  scoped.get("/epics", async (c) => {
    const epics = await c.get("repo").findEpicsByProject(c.get("project").id);
    return c.json({ epics });
  });

  scoped.post("/epics", async (c) => {
    const body = parseBody(EpicCreateSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const row = {
      id: newId(),
      projectId: project.id,
      title: body.title,
      description: body.description ?? null,
      status: "open",
      priority: body.priority ?? 3,
      targetSprintId: body.targetSprintId ?? null,
      createdAt: now(),
    };
    await repo.insertEpic(row);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: null,
      kind: "epic.opened",
      refId: row.id,
      summary: `epic: ${row.title}`,
    });
    return c.json(row, 201);
  });

  scoped.patch("/epics/:id", async (c) => {
    const body = parseBody(EpicPatchSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const updates: EpicUpdate = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.status !== undefined) updates.status = body.status;
    if (body.targetSprintId !== undefined) updates.targetSprintId = body.targetSprintId;
    if (Object.keys(updates).length === 0) return c.json({ id: c.req.param("id"), changed: false });
    await repo.updateEpic(c.req.param("id"), updates);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: null,
      kind: "epic.updated",
      refId: c.req.param("id"),
      summary: `epic updated: ${Object.keys(updates).join(", ")}`,
    });
    return c.json({ id: c.req.param("id"), changed: true, updates });
  });

  scoped.get("/stories/backlog", async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    const rows = await c.get("repo").findBacklogStories(c.get("project").id, limit);
    return c.json({ count: rows.length, stories: rows });
  });

  scoped.post("/stories", async (c) => {
    const body = parseBody(StoryCreateSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const id = newId();
    const initialStatus = body.sprintId ? "todo" : "backlog";
    await repo.insertStory({
      id,
      projectId: project.id,
      epicId: body.epicId ?? null,
      sprintId: body.sprintId ?? null,
      title: body.title,
      description: body.description ?? null,
      acceptance: body.acceptance ?? null,
      status: initialStatus,
      size: body.size ?? null,
      assigneeId: body.assigneeId ?? null,
      priority: body.priority ?? 3,
      startedAt: null,
      completedAt: null,
      createdAt: now(),
    });
    const sprintId = body.sprintId ?? (await repo.findActiveSprint(project.id))?.id ?? null;
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId,
      kind: "story.opened",
      refId: id,
      summary: `story: ${body.title}`,
    });
    return c.json({ id, title: body.title, status: initialStatus, sprintId: body.sprintId ?? null }, 201);
  });

  scoped.get("/stories/:id", async (c) => {
    const story = await c.get("repo").findStoryById(c.req.param("id"));
    if (!story || story.projectId !== c.get("project").id) throw httpErrors.notFound("story not found");
    return c.json(story);
  });

  scoped.patch("/stories/:id", async (c) => {
    const body = parseBody(StoryPatchSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const updates: StoryUpdate = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.acceptance !== undefined) updates.acceptance = body.acceptance;
    if (body.status !== undefined) updates.status = body.status;
    if (body.size !== undefined) updates.size = body.size;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;
    if (body.epicId !== undefined) updates.epicId = body.epicId;
    if (body.status === "doing") updates.startedAt = now();
    if (Object.keys(updates).length === 0) return c.json({ id: c.req.param("id"), changed: false });
    await repo.updateStory(c.req.param("id"), updates);
    const active = await repo.findActiveSprint(project.id);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: active?.id ?? null,
      kind: "story.updated",
      refId: c.req.param("id"),
      summary: `story updated: ${Object.keys(updates).join(", ")}`,
    });
    return c.json({ id: c.req.param("id"), changed: true, updates });
  });

  scoped.post("/stories/:id/move", async (c) => {
    const body = parseBody(StoryMoveSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const newStatus = body.sprintId ? "todo" : "backlog";
    await repo.updateStory(c.req.param("id"), { sprintId: body.sprintId, status: newStatus });
    const active = await repo.findActiveSprint(project.id);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: body.sprintId ?? active?.id ?? null,
      kind: "story.moved",
      refId: c.req.param("id"),
      summary: body.sprintId ? `story moved to sprint ${body.sprintId}` : "story moved to backlog",
    });
    return c.json({ id: c.req.param("id"), sprintId: body.sprintId, status: newStatus });
  });

  scoped.post("/stories/:id/close", async (c) => {
    const body = parseBody(StoryCloseSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const status = body.dropped ? "dropped" : "done";
    await repo.updateStory(c.req.param("id"), { status, completedAt: now() });
    const active = await repo.findActiveSprint(project.id);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: active?.id ?? null,
      kind: "story.closed",
      refId: c.req.param("id"),
      summary: `story ${status}`,
    });
    return c.json({ id: c.req.param("id"), status });
  });

  scoped.post("/tasks", async (c) => {
    const body = parseBody(TaskCreateSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const story = await repo.findStoryById(body.storyId);
    if (!story || story.projectId !== project.id) throw httpErrors.notFound("story not found");
    const row = {
      id: newId(),
      storyId: body.storyId,
      assigneeId: body.assigneeId ?? null,
      title: body.title,
      status: "todo",
      blockedBy: null,
      createdAt: now(),
    };
    await repo.insertTask(row);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: story.sprintId,
      kind: "task.opened",
      refId: row.id,
      summary: `task: ${row.title}`,
    });
    return c.json(row, 201);
  });

  scoped.patch("/tasks/:id", async (c) => {
    const body = parseBody(TaskPatchSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const updates: TaskUpdate = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.status !== undefined) updates.status = body.status;
    if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;
    if (body.blockedBy !== undefined) updates.blockedBy = body.blockedBy;
    if (Object.keys(updates).length === 0) return c.json({ id: c.req.param("id"), changed: false });
    await repo.updateTask(c.req.param("id"), updates);
    const active = await repo.findActiveSprint(project.id);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: active?.id ?? null,
      kind: body.status === "done" ? "task.closed" : "task.updated",
      refId: c.req.param("id"),
      summary: `task updated: ${Object.keys(updates).join(", ")}`,
    });
    return c.json({ id: c.req.param("id"), changed: true, updates });
  });

  scoped.get("/debt", async (c) => {
    const limit = Number(c.req.query("limit") ?? "100");
    const all = c.req.query("all") === "1";
    const repo = c.get("repo");
    const project = c.get("project");
    const rows = all
      ? await repo.findAllDebtByProject(project.id, limit)
      : await repo.findOpenDebtByProject(project.id, limit);
    return c.json({ count: rows.length, debt: rows });
  });

  scoped.post("/debt", async (c) => {
    const body = parseBody(DebtCreateSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    if (body.location) {
      const existing = await repo.findOpenDebtAtLocation(project.id, body.location);
      if (existing) return c.json({ id: existing.id, duplicate: true }, 200);
    }
    const row = {
      id: newId(),
      projectId: project.id,
      title: body.title,
      description: body.description ?? null,
      severity: body.severity ?? "med",
      location: body.location ?? null,
      ownerId: developer.id,
      expiresAt: body.expiresAt ?? null,
      openedAt: now(),
      closedAt: null,
      linkedStoryId: body.linkedStoryId ?? null,
    };
    await repo.insertDebt(row);
    const active = await repo.findActiveSprint(project.id);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: active?.id ?? null,
      kind: "debt.opened",
      refId: row.id,
      summary: `debt: ${row.title}`,
    });
    return c.json(row, 201);
  });

  scoped.post("/debt/:id/close", async (c) => {
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    await repo.closeDebt(c.req.param("id"), now());
    const active = await repo.findActiveSprint(project.id);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: active?.id ?? null,
      kind: "debt.closed",
      refId: c.req.param("id"),
      summary: "debt closed",
    });
    return c.json({ id: c.req.param("id"), status: "closed" });
  });

  scoped.get("/decisions", async (c) => {
    const limit = Number(c.req.query("limit") ?? "100");
    const rows = await c.get("repo").findDecisionsByProject(c.get("project").id, limit);
    return c.json({ count: rows.length, decisions: rows });
  });

  scoped.post("/decisions", async (c) => {
    const body = parseBody(DecisionCreateSchema, await c.req.json().catch(() => ({})));
    const repo = c.get("repo");
    const project = c.get("project");
    const developer = c.get("developer");
    const row = {
      id: newId(),
      projectId: project.id,
      title: body.title,
      context: body.context ?? null,
      decision: body.decision,
      status: body.status ?? "accepted",
      decidedAt: now(),
    };
    await repo.insertDecision(row);
    const active = await repo.findActiveSprint(project.id);
    await emitEvent(repo, {
      projectId: project.id,
      developerId: developer.id,
      sprintId: active?.id ?? null,
      kind: "decision.recorded",
      refId: row.id,
      summary: `decision: ${row.title}`,
    });
    return c.json(row, 201);
  });

  scoped.get("/events", async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    const events = await c.get("repo").findRecentEvents(c.get("project").id, limit);
    return c.json({ count: events.length, events });
  });

  app.route("/:slug", scoped);
  return app;
}
