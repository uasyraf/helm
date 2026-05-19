import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const project = sqliteTable("project", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  gitRemote: text("git_remote"),
  dod: text("dod"),
  sprintLengthDays: integer("sprint_length_days").notNull().default(14),
  wipEnabled: integer("wip_enabled", { mode: "boolean" }).notNull().default(false),
  estimationEnabled: integer("estimation_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const developer = sqliteTable("developer", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  handle: text("handle").notNull(),
  email: text("email"),
  oidcSub: text("oidc_sub"),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const sprint = sqliteTable("sprint", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  name: text("name").notNull(),
  goal: text("goal"),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  status: text("status").notNull(),
  wipLimit: integer("wip_limit"),
});

export const epic = sqliteTable("epic", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: integer("priority").notNull().default(3),
  targetSprintId: text("target_sprint_id").references(() => sprint.id),
  createdAt: text("created_at").notNull(),
});

export const story = sqliteTable("story", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  epicId: text("epic_id").references(() => epic.id),
  sprintId: text("sprint_id").references(() => sprint.id),
  title: text("title").notNull(),
  description: text("description"),
  acceptance: text("acceptance"),
  status: text("status").notNull().default("backlog"),
  size: text("size"),
  assigneeId: text("assignee_id").references(() => developer.id),
  priority: integer("priority").notNull().default(3),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});

export const task = sqliteTable("task", {
  id: text("id").primaryKey(),
  storyId: text("story_id").notNull().references(() => story.id),
  assigneeId: text("assignee_id").references(() => developer.id),
  title: text("title").notNull(),
  status: text("status").notNull().default("todo"),
  blockedBy: text("blocked_by"),
  createdAt: text("created_at").notNull(),
});

export const techDebt = sqliteTable("tech_debt", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  title: text("title").notNull(),
  description: text("description"),
  severity: text("severity").notNull().default("med"),
  location: text("location"),
  ownerId: text("owner_id").references(() => developer.id),
  expiresAt: text("expires_at"),
  openedAt: text("opened_at").notNull(),
  closedAt: text("closed_at"),
  linkedStoryId: text("linked_story_id").references(() => story.id),
});

export const decision = sqliteTable("decision", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  title: text("title").notNull(),
  context: text("context"),
  decision: text("decision").notNull(),
  status: text("status").notNull().default("accepted"),
  decidedAt: text("decided_at").notNull(),
});

export const progressEvent = sqliteTable("progress_event", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  developerId: text("developer_id").references(() => developer.id),
  sprintId: text("sprint_id").references(() => sprint.id),
  kind: text("kind").notNull(),
  refId: text("ref_id"),
  summary: text("summary").notNull(),
  userSub: text("user_sub"),
  ts: text("ts").notNull(),
});

export const schemaMeta = sqliteTable("schema_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const schema = {
  project,
  developer,
  sprint,
  epic,
  story,
  task,
  techDebt,
  decision,
  progressEvent,
};

export type Project = typeof project.$inferSelect;
export type Developer = typeof developer.$inferSelect;
export type Sprint = typeof sprint.$inferSelect;
export type Epic = typeof epic.$inferSelect;
export type Story = typeof story.$inferSelect;
export type Task = typeof task.$inferSelect;
export type TechDebt = typeof techDebt.$inferSelect;
export type Decision = typeof decision.$inferSelect;
export type ProgressEvent = typeof progressEvent.$inferSelect;
