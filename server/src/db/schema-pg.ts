import { pgTable, text, integer, boolean, primaryKey, index } from "drizzle-orm/pg-core";

export const project = pgTable("project", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  gitRemote: text("git_remote"),
  dod: text("dod"),
  sprintLengthDays: integer("sprint_length_days").notNull().default(14),
  wipEnabled: boolean("wip_enabled").notNull().default(false),
  estimationEnabled: boolean("estimation_enabled").notNull().default(true),
  openJoin: boolean("open_join").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const projectMember = pgTable(
  "project_member",
  {
    projectId: text("project_id").notNull().references(() => project.id),
    userSub: text("user_sub").notNull(),
    role: text("role").$type<"owner" | "member">().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.projectId, t.userSub] }),
    userSubIdx: index("idx_project_member_user_sub").on(t.userSub),
  }),
);

export const developer = pgTable("developer", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  handle: text("handle").notNull(),
  email: text("email"),
  oidcSub: text("oidc_sub"),
  lastSeenAt: text("last_seen_at").notNull(),
});

export const sprint = pgTable("sprint", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  name: text("name").notNull(),
  goal: text("goal"),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  status: text("status").notNull(),
  wipLimit: integer("wip_limit"),
});

export const epic = pgTable("epic", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: integer("priority").notNull().default(3),
  targetSprintId: text("target_sprint_id").references(() => sprint.id),
  createdAt: text("created_at").notNull(),
});

export const story = pgTable("story", {
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

export const task = pgTable("task", {
  id: text("id").primaryKey(),
  storyId: text("story_id").notNull().references(() => story.id),
  assigneeId: text("assignee_id").references(() => developer.id),
  title: text("title").notNull(),
  status: text("status").notNull().default("todo"),
  blockedBy: text("blocked_by"),
  createdAt: text("created_at").notNull(),
});

export const techDebt = pgTable("tech_debt", {
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

export const decision = pgTable("decision", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => project.id),
  title: text("title").notNull(),
  context: text("context"),
  decision: text("decision").notNull(),
  status: text("status").notNull().default("accepted"),
  decidedAt: text("decided_at").notNull(),
});

export const progressEvent = pgTable("progress_event", {
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

export const schemaMeta = pgTable("schema_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const schema = {
  project,
  projectMember,
  developer,
  sprint,
  epic,
  story,
  task,
  techDebt,
  decision,
  progressEvent,
};

type ProjectRow = typeof project.$inferSelect;
// openJoin defaults to false at the DB layer; mark it optional in the TS type so
// existing Project literals (constructed before the column existed) keep compiling.
export type Project = Omit<ProjectRow, "openJoin"> & { openJoin?: boolean };
export type ProjectMember = typeof projectMember.$inferSelect;
