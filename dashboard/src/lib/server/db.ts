import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { join } from "node:path";
import { homedir } from "node:os";
import { schema } from "$helm/db/schema.js";

export type DashboardDb = LibSQLDatabase<typeof schema>;

let cached: DashboardDb | null = null;

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

export function db(): DashboardDb {
  if (cached) return cached;
  const slug = activeSlug();
  const path = join(helmHome(), `${slug}.db`);
  const syncUrl = process.env.HELM_SYNC_URL;
  const syncToken = process.env.HELM_SYNC_TOKEN;
  const syncIntervalSec = Number(process.env.HELM_SYNC_INTERVAL_MS ?? "5000") / 1000;
  const client = syncUrl
    ? createClient({ url: `file:${path}`, syncUrl, authToken: syncToken, syncInterval: syncIntervalSec })
    : createClient({ url: `file:${path}` });
  cached = drizzle(client, { schema });
  return cached;
}
