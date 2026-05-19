import type { Context, MiddlewareHandler } from "hono";
import type { HelmRepo } from "../../db/repo.js";
import type { Project, Developer } from "../../db/schema.js";
import { httpErrors } from "./errors.js";

export interface RestActor {
  developerId: string | null;
  userSub: string | null;
  handle: string;
  email: string | null;
  isAdmin: boolean;
  allowedProjects: ReadonlySet<string> | "all";
}

export interface RestEnv {
  Variables: {
    repo: HelmRepo;
    actor: RestActor;
    project: Project;
    developer: Developer;
  };
}

export type RestContext = Context<RestEnv>;
export type RestMiddleware = MiddlewareHandler<RestEnv>;

export function requireProjectAccess(c: RestContext, slug: string): void {
  const actor = c.get("actor");
  if (actor.allowedProjects === "all") return;
  if (!actor.allowedProjects.has(slug)) {
    throw httpErrors.forbidden(`no access to project '${slug}'`);
  }
}

export function requireAdmin(c: RestContext): void {
  const actor = c.get("actor");
  if (!actor.isAdmin) throw httpErrors.forbidden("admin role required");
}
