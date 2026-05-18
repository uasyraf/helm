import { detectProject } from "../project/detect.js";
import { loadConfig } from "../config/load.js";
import { dbPathFor } from "../util/paths.js";
import { openDb } from "./client.js";
import { openPgDb, openPgliteDb } from "./pg-client.js";
import { makeSqliteRepo } from "./repo-sqlite.js";
import { makePgRepo } from "./repo-pg.js";
import type { RepoHandle } from "./repo.js";

export interface OpenedProjectRepo {
  handle: RepoHandle;
  slug: string;
  cwd: string;
  target: "libsql" | "postgres";
}

export async function openProjectRepo(cwd: string): Promise<OpenedProjectRepo> {
  const detected = detectProject(cwd);
  const dbUrl = process.env.HELM_DB_URL ?? "";

  if (dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://")) {
    const pg = await openPgDb(dbUrl);
    return {
      handle: { repo: makePgRepo(pg.db), sync: null, close: pg.close },
      slug: detected.slug,
      cwd,
      target: "postgres",
    };
  }

  if (dbUrl === "memory:pglite") {
    const pg = await openPgliteDb();
    return {
      handle: { repo: makePgRepo(pg.db), sync: null, close: pg.close },
      slug: detected.slug,
      cwd,
      target: "postgres",
    };
  }

  const config = loadConfig(cwd);
  const path = dbPathFor(detected.slug);
  const sqlite = await openDb(path, { sync: config.sync });
  return {
    handle: {
      repo: makeSqliteRepo(sqlite.db),
      sync: sqlite.sync,
      close: async () => {
        sqlite.client.close();
      },
    },
    slug: detected.slug,
    cwd,
    target: "libsql",
  };
}
