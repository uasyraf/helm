import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { developer, project, sprint } from "../db/schema.js";
import type { Project, Developer, Sprint } from "../db/schema.js";
import { newId, now } from "../util/ids.js";
import { detectProject } from "./detect.js";
import { resolveIdentity } from "./identity.js";
import { emitEvent } from "../events/emit.js";

export interface SessionContext {
  project: Project;
  developer: Developer;
  activeSprint: Sprint;
  warnings: string[];
}

export async function bootstrapSession(db: Db, cwd: string): Promise<SessionContext> {
  const warnings: string[] = [];
  const detected = detectProject(cwd);
  if (detected.warning) warnings.push(detected.warning);

  const identity = resolveIdentity(cwd);
  if (identity.prompt) warnings.push(identity.prompt);

  const projectRow = await ensureProject(db, detected);
  const developerRow = await ensureDeveloper(db, projectRow.id, identity);
  const sprintRow = await ensureActiveSprint(db, projectRow, developerRow.id);

  return {
    project: projectRow,
    developer: developerRow,
    activeSprint: sprintRow,
    warnings,
  };
}

async function ensureProject(db: Db, detected: ReturnType<typeof detectProject>): Promise<Project> {
  const existing = await db.select().from(project).where(eq(project.slug, detected.slug)).limit(1);
  if (existing[0]) return existing[0];

  const row: Project = {
    id: newId(),
    slug: detected.slug,
    name: detected.name,
    gitRemote: detected.gitRemote,
    dod: null,
    sprintLengthDays: 14,
    wipEnabled: false,
    estimationEnabled: true,
    createdAt: now(),
  };
  await db.insert(project).values(row);
  return row;
}

async function ensureDeveloper(
  db: Db,
  projectId: string,
  identity: ReturnType<typeof resolveIdentity>,
): Promise<Developer> {
  const existing = await db
    .select()
    .from(developer)
    .where(and(eq(developer.projectId, projectId), eq(developer.handle, identity.handle)))
    .limit(1);

  if (existing[0]) {
    const updated: Developer = { ...existing[0], lastSeenAt: now() };
    await db.update(developer).set({ lastSeenAt: updated.lastSeenAt }).where(eq(developer.id, existing[0].id));
    return updated;
  }

  const row: Developer = {
    id: newId(),
    projectId,
    handle: identity.handle,
    email: identity.email,
    lastSeenAt: now(),
  };
  await db.insert(developer).values(row);
  return row;
}

async function ensureActiveSprint(db: Db, projectRow: Project, developerId: string): Promise<Sprint> {
  const existing = await db
    .select()
    .from(sprint)
    .where(and(eq(sprint.projectId, projectRow.id), eq(sprint.status, "active")))
    .limit(1);
  if (existing[0]) return existing[0];

  const row: Sprint = {
    id: newId(),
    projectId: projectRow.id,
    name: `sprint-1`,
    goal: null,
    startedAt: now(),
    endedAt: null,
    status: "active",
    wipLimit: null,
  };
  await db.insert(sprint).values(row);
  await emitEvent(db, {
    projectId: projectRow.id,
    developerId,
    sprintId: row.id,
    kind: "sprint.started",
    refId: row.id,
    summary: `${row.name} started (default, 14d)`,
  });
  return row;
}
