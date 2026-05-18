import type { HelmRepo } from "../db/repo.js";
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

export async function bootstrapSession(repo: HelmRepo, cwd: string): Promise<SessionContext> {
  const warnings: string[] = [];
  const detected = detectProject(cwd);
  if (detected.warning) warnings.push(detected.warning);

  const identity = resolveIdentity(cwd);
  if (identity.prompt) warnings.push(identity.prompt);

  const projectRow = await ensureProject(repo, detected);
  const developerRow = await ensureDeveloper(repo, projectRow.id, identity);
  const sprintRow = await ensureActiveSprint(repo, projectRow, developerRow.id);

  return {
    project: projectRow,
    developer: developerRow,
    activeSprint: sprintRow,
    warnings,
  };
}

async function ensureProject(repo: HelmRepo, detected: ReturnType<typeof detectProject>): Promise<Project> {
  const existing = await repo.findProjectBySlug(detected.slug);
  if (existing) return existing;
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
  await repo.insertProject(row);
  return row;
}

async function ensureDeveloper(
  repo: HelmRepo,
  projectId: string,
  identity: ReturnType<typeof resolveIdentity>,
): Promise<Developer> {
  const existing = await repo.findDeveloperByHandle(projectId, identity.handle);
  if (existing) {
    const updated: Developer = { ...existing, lastSeenAt: now() };
    await repo.touchDeveloper(existing.id, updated.lastSeenAt);
    return updated;
  }
  const row: Developer = {
    id: newId(),
    projectId,
    handle: identity.handle,
    email: identity.email,
    lastSeenAt: now(),
  };
  await repo.insertDeveloper(row);
  return row;
}

async function ensureActiveSprint(repo: HelmRepo, projectRow: Project, developerId: string): Promise<Sprint> {
  const existing = await repo.findActiveSprint(projectRow.id);
  if (existing) return existing;
  const row: Sprint = {
    id: newId(),
    projectId: projectRow.id,
    name: "sprint-1",
    goal: null,
    startedAt: now(),
    endedAt: null,
    status: "active",
    wipLimit: null,
  };
  await repo.insertSprint(row);
  await emitEvent(repo, {
    projectId: projectRow.id,
    developerId,
    sprintId: row.id,
    kind: "sprint.started",
    refId: row.id,
    summary: `${row.name} started (default, 14d)`,
  });
  return row;
}
