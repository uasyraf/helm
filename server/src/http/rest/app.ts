import { Hono } from "hono";
import type { RestActor, RestEnv } from "./context.js";
import { HttpError, toBody } from "./errors.js";
import { stubAuthMiddleware } from "./stub-auth.js";
import { buildProjectRoutes } from "./routes-projects.js";
import { buildAdminRoutes } from "./routes-admin.js";
import type { HelmRepo } from "../../db/repo.js";

export interface RestAppOptions {
  repo: HelmRepo;
  authMiddleware?: import("./context.js").RestMiddleware;
  oauthMetadata?: () => OAuthProtectedResourceMetadata | null;
}

export interface OAuthProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
}

export function buildRestApp(opts: RestAppOptions): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  app.use("*", async (c, next) => {
    if (c.req.path === "/healthz") {
      await next();
      return;
    }
    const start = Date.now();
    await next();
    const actor = c.get("actor") as RestActor | undefined;
    const actorId = actor?.userSub ?? "anonymous";
    console.log(
      `[helm-rest] ${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms actor=${actorId}`,
    );
  });

  app.use("*", async (c, next) => {
    c.set("repo", opts.repo);
    await next();
  });

  app.get("/healthz", async (c) => {
    try {
      await opts.repo.findAllProjects();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 503);
    }
  });

  app.get("/.well-known/oauth-protected-resource", async (c) => {
    const meta = opts.oauthMetadata?.();
    if (!meta) return c.json({ error: { code: "NOT_FOUND", message: "OAuth not configured" } }, 404);
    return c.json(meta);
  });

  app.use("/v1/*", opts.authMiddleware ?? stubAuthMiddleware);
  app.route("/v1/projects", buildProjectRoutes());
  app.route("/v1/admin", buildAdminRoutes());

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(toBody(err), err.status as 400 | 401 | 403 | 404 | 409);
    }
    console.error("[helm-rest] unhandled:", err);
    return c.json(
      { error: { code: "INTERNAL", message: "internal server error" } },
      500,
    );
  });

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "route not found" } }, 404));

  return app;
}
