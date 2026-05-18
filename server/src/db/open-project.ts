import { openDb, type DbHandle } from "./client.js";
import { detectProject } from "../project/detect.js";
import { loadConfig } from "../config/load.js";
import { dbPathFor } from "../util/paths.js";

export interface OpenedProject {
  handle: DbHandle;
  slug: string;
  cwd: string;
}

export async function openProjectDb(cwd: string): Promise<OpenedProject> {
  const detected = detectProject(cwd);
  const config = loadConfig(cwd);
  const path = dbPathFor(detected.slug);
  const handle = await openDb(path, { sync: config.sync });
  return { handle, slug: detected.slug, cwd };
}
