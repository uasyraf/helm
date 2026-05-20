import type { HelmRepo } from "../../db/repo.js";
import type { Developer, Project } from "../../db/schema.js";
import { newId, now } from "../../util/ids.js";
import { httpErrors } from "./errors.js";
import type { RestActor, RestMiddleware } from "./context.js";

// loadProject resolves :slug → c.set("project", ...). Does NOT enforce access
// and does NOT materialize a developer row. Mount this on any route that needs
// `c.get("project")` but must run BEFORE membership/claim gating — notably the
// /join route, where the caller is by definition not yet a member.
export const loadProject: RestMiddleware = async (c, next) => {
  const slug = c.req.param("slug");
  if (!slug) throw httpErrors.badRequest("missing project slug");
  const repo = c.get("repo");
  const project = await repo.findProjectBySlug(slug);
  if (!project) throw httpErrors.notFound(`project '${slug}' not found`);
  c.set("project", project);
  await next();
};

// requireProjectMembership enforces claim ∪ membership against the project
// loaded by `loadProject`. 403s when neither covers the slug. Note: this is
// distinct from the legacy `requireProjectAccess` helper in context.ts, which
// is a claim-only synchronous check used by no current route.
export const requireProjectMembership: RestMiddleware = async (c, next) => {
  const project = c.get("project");
  const actor = c.get("actor");
  const claimCovers = actor.allowedProjects === "all" || actor.allowedProjects.has(project.slug);
  if (!claimCovers) {
    const repo = c.get("repo");
    const member = actor.userSub
      ? await repo.findProjectMember(project.id, actor.userSub)
      : null;
    if (!member) throw httpErrors.forbidden(`no access to project '${project.slug}'`);
  }
  await next();
};

// ensureDeveloperMiddleware materializes (or refreshes) the per-project
// `developer` row for the caller and stashes it on the context. Must run AFTER
// requireProjectMembership so we never create rows for callers who shouldn't
// even see the project (handle-squat surface — see F2 of the T3+T4 red-cell).
export const ensureDeveloperMiddleware: RestMiddleware = async (c, next) => {
  const project = c.get("project");
  const actor = c.get("actor");
  const repo = c.get("repo");
  const developer = await ensureDeveloper(repo, project.id, actor);
  c.set("developer", developer);
  await next();
};

async function ensureDeveloper(repo: HelmRepo, projectId: string, actor: RestActor): Promise<Developer> {
  const existing = await repo.findDeveloperByHandle(projectId, actor.handle);
  if (existing) {
    await repo.touchDeveloper(existing.id, now());
    return { ...existing, lastSeenAt: now() };
  }
  const row: Developer = {
    id: newId(),
    projectId,
    handle: actor.handle,
    email: actor.email,
    oidcSub: actor.userSub,
    lastSeenAt: now(),
  };
  await repo.insertDeveloper(row);
  return row;
}

export function projectContext(c: { get: <K extends "project" | "developer">(k: K) => K extends "project" ? Project : Developer }): {
  project: Project;
  developer: Developer;
} {
  return { project: c.get("project"), developer: c.get("developer") };
}
