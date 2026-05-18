import { openDb, type DbHandle } from "./client.js";
import { openPgDb, type PgHandle } from "./pg-client.js";
import { detectProject } from "../project/detect.js";
import { loadConfig } from "../config/load.js";
import { dbPathFor } from "../util/paths.js";

export interface OpenedProject {
  handle: DbHandle;
  slug: string;
  cwd: string;
}

export interface OpenedPgProject {
  handle: PgHandle;
  slug: string;
  cwd: string;
  url: string;
}

export type ProjectTarget = "libsql" | "postgres";

export function projectTarget(): ProjectTarget {
  const url = process.env.HELM_DB_URL ?? "";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgres";
  return "libsql";
}

export async function openProjectDb(cwd: string): Promise<OpenedProject> {
  const detected = detectProject(cwd);
  const config = loadConfig(cwd);
  const path = dbPathFor(detected.slug);
  const handle = await openDb(path, { sync: config.sync });
  return { handle, slug: detected.slug, cwd };
}

export async function openPgProjectDb(cwd: string): Promise<OpenedPgProject> {
  const detected = detectProject(cwd);
  const url = process.env.HELM_DB_URL;
  if (!url) throw new Error("HELM_DB_URL not set");
  const handle = await openPgDb(url);
  return { handle, slug: detected.slug, cwd, url };
}
