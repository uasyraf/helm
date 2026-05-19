import type { HelmRepo } from "../../db/repo.js";
import type { Developer, Project } from "../../db/schema.js";
import { newId, now } from "../../util/ids.js";
import { httpErrors } from "./errors.js";
import type { RestActor, RestMiddleware } from "./context.js";

export const loadProjectAndActor: RestMiddleware = async (c, next) => {
  const slug = c.req.param("slug");
  if (!slug) throw httpErrors.badRequest("missing project slug");
  const repo = c.get("repo");
  const project = await repo.findProjectBySlug(slug);
  if (!project) throw httpErrors.notFound(`project '${slug}' not found`);
  const actor = c.get("actor");
  if (actor.allowedProjects !== "all" && !actor.allowedProjects.has(slug)) {
    throw httpErrors.forbidden(`no access to project '${slug}'`);
  }
  const developer = await ensureDeveloper(repo, project.id, actor);
  c.set("project", project);
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
