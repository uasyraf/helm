import type { HelmRepo } from "../db/repo.js";
import type { Project, Developer, Sprint } from "../db/schema.js";
import { newId, now } from "../util/ids.js";
import { detectProject } from "./detect.js";
import { resolveIdentity } from "./identity.js";
import { emitEvent } from "../events/emit.js";

export interface SessionIdentity {
  handle: string;
  email: string | null;
  userSub: string | null;
}

export interface SessionContext {
  project: Project;
  developer: Developer;
  activeSprint: Sprint;
  warnings: string[];
  pending: boolean;
}

export async function bootstrapSession(repo: HelmRepo, cwd: string): Promise<SessionContext> {
  const warnings: string[] = [];
  const detected = detectProject(cwd);
  if (detected.warning) warnings.push(detected.warning);

  const identity = resolveIdentity(cwd);
  if (identity.prompt) warnings.push(identity.prompt);

  const projectRow = await ensureProject(repo, detected);
  const developerRow = await ensureDeveloper(repo, projectRow.id, {
    handle: identity.handle,
    email: identity.email,
    userSub: null,
  });
  const sprintRow = await ensureActiveSprint(repo, projectRow, developerRow.id);

  return {
    project: projectRow,
    developer: developerRow,
    activeSprint: sprintRow,
    warnings,
    pending: false,
  };
}

export async function bootstrapSessionForProject(
  repo: HelmRepo,
  slug: string,
  identity: SessionIdentity,
): Promise<SessionContext> {
  const project = await repo.findProjectBySlug(slug);
  if (!project) throw new Error(`project '${slug}' not found`);
  const developerRow = await ensureDeveloper(repo, project.id, identity);
  const sprintRow = await ensureActiveSprint(repo, project, developerRow.id);
  return { project, developer: developerRow, activeSprint: sprintRow, warnings: [], pending: false };
}

export function pendingSession(): SessionContext {
  return {
    project: pendingProject,
    developer: pendingDeveloper,
    activeSprint: pendingSprint,
    warnings: [],
    pending: true,
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

async function ensureDeveloper(repo: HelmRepo, projectId: string, identity: SessionIdentity): Promise<Developer> {
  let existing: Developer | null = null;
  if (identity.userSub && repo.findDeveloperByOidcSub) {
    existing = await repo.findDeveloperByOidcSub(projectId, identity.userSub);
  }
  if (!existing) {
    existing = await repo.findDeveloperByHandle(projectId, identity.handle);
  }
  if (existing) {
    const updated: Developer = { ...existing, lastSeenAt: now() };
    await repo.touchDeveloper(existing.id, updated.lastSeenAt);
    if (identity.userSub && !existing.oidcSub && repo.setDeveloperOidcSub) {
      await repo.setDeveloperOidcSub(existing.id, identity.userSub);
      updated.oidcSub = identity.userSub;
    }
    return updated;
  }
  const row: Developer = {
    id: newId(),
    projectId,
    handle: identity.handle,
    email: identity.email,
    oidcSub: identity.userSub,
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

const pendingProject: Project = {
  id: "__pending__",
  slug: "__pending__",
  name: "(no project selected)",
  gitRemote: null,
  dod: null,
  sprintLengthDays: 14,
  wipEnabled: false,
  estimationEnabled: true,
  createdAt: "1970-01-01T00:00:00.000Z",
};

const pendingDeveloper: Developer = {
  id: "__pending__",
  projectId: "__pending__",
  handle: "__pending__",
  email: null,
  oidcSub: null,
  lastSeenAt: "1970-01-01T00:00:00.000Z",
};

const pendingSprint: Sprint = {
  id: "__pending__",
  projectId: "__pending__",
  name: "__pending__",
  goal: null,
  startedAt: "1970-01-01T00:00:00.000Z",
  endedAt: null,
  status: "pending",
  wipLimit: null,
};
