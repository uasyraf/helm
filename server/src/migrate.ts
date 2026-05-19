import { readdirSync, renameSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { bootstrap } from "./db/bootstrap.js";
import { helmHome, unifiedDbPath } from "./util/paths.js";

export interface MigrateResult {
  unifiedPath: string;
  merged: { source: string; slug: string; rowsCopied: number }[];
  skipped: { source: string; reason: string }[];
}

const TABLES_IN_ORDER = [
  "project",
  "developer",
  "sprint",
  "epic",
  "story",
  "task",
  "tech_debt",
  "decision",
  "progress_event",
] as const;

export async function runMigrate(): Promise<MigrateResult> {
  const home = helmHome();
  const target = unifiedDbPath();
  const merged: MigrateResult["merged"] = [];
  const skipped: MigrateResult["skipped"] = [];

  const dest = createClient({ url: `file:${target}` });
  await bootstrap(dest);

  const sources = listSourceDbs(home, target);
  for (const src of sources) {
    const source = createClient({ url: `file:${src}` });
    try {
      await bootstrap(source); // ensures story.project_id is backfilled before copy
      const projects = await readRows(source, "project");
      if (projects.length === 0) {
        skipped.push({ source: basename(src), reason: "no project row" });
        continue;
      }
      const slug = String(projects[0]?.slug ?? "");
      const existing = await dest.execute({ sql: "SELECT id FROM project WHERE slug = ?", args: [slug] });
      if (existing.rows.length > 0) {
        skipped.push({ source: basename(src), reason: `slug "${slug}" already in unified DB` });
        continue;
      }

      let total = 0;
      for (const table of TABLES_IN_ORDER) {
        const rows = await readRows(source, table);
        for (const row of rows) {
          await insertRow(dest, table, row);
          total++;
        }
      }
      merged.push({ source: basename(src), slug, rowsCopied: total });
      renameSync(src, `${src}.bak`);
    } finally {
      source.close();
    }
  }
  dest.close();
  return { unifiedPath: target, merged, skipped };
}

function listSourceDbs(home: string, target: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(home);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.endsWith(".db")) continue;
    const full = join(home, e);
    if (full === target) continue;
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    out.push(full);
  }
  return out;
}

async function readRows(client: Client, table: string): Promise<Record<string, unknown>[]> {
  const res = await client.execute(`SELECT * FROM ${table}`);
  return res.rows.map((r) => ({ ...r }));
}

async function insertRow(client: Client, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const placeholders = cols.map(() => "?").join(", ");
  const values = cols.map((c) => row[c] as never);
  await client.execute({
    sql: `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
    args: values,
  });
}
