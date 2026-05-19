import { Hono } from "hono";
import type { RestEnv } from "./context.js";
import { requireAdmin } from "./context.js";
import { exportAll, importAll, EXPORT_FORMAT_VERSION, type HelmDump } from "../../admin/export-import.js";
import { SCHEMA_VERSION } from "../../db/bootstrap.js";
import { httpErrors } from "./errors.js";

export function buildAdminRoutes(): Hono<RestEnv> {
  const app = new Hono<RestEnv>();

  app.get("/export", async (c) => {
    requireAdmin(c);
    const dump = await exportAll(c.get("repo"), SCHEMA_VERSION);
    return c.json(dump);
  });

  app.post("/import", async (c) => {
    requireAdmin(c);
    const body = (await c.req.json().catch(() => null)) as HelmDump | null;
    if (!body || body.format !== EXPORT_FORMAT_VERSION) {
      throw httpErrors.badRequest(`expected dump with format=${EXPORT_FORMAT_VERSION}`);
    }
    const result = await importAll(c.get("repo"), body);
    return c.json({ ok: true, ...result });
  });

  return app;
}
