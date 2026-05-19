import { createClient } from "@libsql/client";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { join } from "node:path";
import { homedir } from "node:os";
import { schema } from "$helm/db/schema.js";
import { schema as pgSchema } from "$helm/db/schema-pg.js";
import { makeSqliteRepo } from "$helm/db/repo-sqlite.js";
import { makePgRepo } from "$helm/db/repo-pg.js";
import { bootstrap } from "$helm/db/bootstrap.js";
import { bootstrapPg } from "$helm/db/pg-bootstrap.js";
import type { HelmRepo } from "$helm/db/repo.js";
import { makeRemoteHelmRepo } from "./remote-repo.js";

let cached: HelmRepo | null = null;

function helmHome(): string {
  return process.env.HELM_HOME ?? join(homedir(), ".helm");
}

function unifiedDbPath(): string {
  return process.env.HELM_DB_PATH ?? join(helmHome(), "helm.db");
}

export function defaultSlug(): string | null {
  return process.env.HELM_PROJECT_SLUG ?? null;
}

export async function repo(): Promise<HelmRepo> {
  if (cached) return cached;

  const helmUrl = process.env.HELM_URL;
  if (helmUrl) {
    cached = makeRemoteHelmRepo({ baseUrl: helmUrl, token: process.env.HELM_TOKEN });
    return cached;
  }

  const dbUrl = process.env.HELM_DB_URL ?? "";

  if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
    const [{ Pool }, { drizzle }] = await Promise.all([
      import("pg"),
      import("drizzle-orm/node-postgres"),
    ]);
    const pool = new Pool({ connectionString: dbUrl });
    await bootstrapPg({ query: async (sql) => { await pool.query(sql); } });
    const pg = drizzle(pool, { schema: pgSchema });
    cached = makePgRepo(pg);
    return cached;
  }

  const path = unifiedDbPath();
  const client = createClient({ url: `file:${path}` });
  await bootstrap(client);
  const drizzled = drizzleLibsql(client, { schema });
  cached = makeSqliteRepo(drizzled);
  return cached;
}
