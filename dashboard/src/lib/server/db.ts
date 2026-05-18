import { createClient } from "@libsql/client";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { join } from "node:path";
import { homedir } from "node:os";
import { schema } from "$helm/db/schema.js";
import { schema as pgSchema } from "$helm/db/schema-pg.js";
import { makeSqliteRepo } from "$helm/db/repo-sqlite.js";
import { makePgRepo } from "$helm/db/repo-pg.js";
import type { HelmRepo } from "$helm/db/repo.js";

let cached: HelmRepo | null = null;

function helmHome(): string {
  return process.env.HELM_HOME ?? join(homedir(), ".helm");
}

export function activeSlug(): string {
  const slug = process.env.HELM_PROJECT_SLUG;
  if (!slug) {
    throw new Error("HELM_PROJECT_SLUG not set — start the dashboard via `helm dashboard`.");
  }
  return slug;
}

export async function repo(): Promise<HelmRepo> {
  if (cached) return cached;
  const dbUrl = process.env.HELM_DB_URL ?? "";

  if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
    const [{ Pool }, { drizzle }] = await Promise.all([
      import("pg"),
      import("drizzle-orm/node-postgres"),
    ]);
    const pool = new Pool({ connectionString: dbUrl });
    const pg = drizzle(pool, { schema: pgSchema });
    cached = makePgRepo(pg);
    return cached;
  }

  const slug = activeSlug();
  const path = join(helmHome(), `${slug}.db`);
  const syncUrl = process.env.HELM_SYNC_URL;
  const syncToken = process.env.HELM_SYNC_TOKEN;
  const syncIntervalSec = Number(process.env.HELM_SYNC_INTERVAL_MS ?? "5000") / 1000;
  const client = syncUrl
    ? createClient({ url: `file:${path}`, syncUrl, authToken: syncToken, syncInterval: syncIntervalSec })
    : createClient({ url: `file:${path}` });
  const drizzled = drizzleLibsql(client, { schema });
  cached = makeSqliteRepo(drizzled);
  return cached;
}
