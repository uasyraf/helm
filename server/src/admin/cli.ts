import { readFileSync, writeFileSync } from "node:fs";
import { openSharedRepo } from "../server.js";
import { exportAll, importAll, EXPORT_FORMAT_VERSION, type HelmDump } from "./export-import.js";
import { SCHEMA_VERSION } from "../db/bootstrap.js";

export interface ExportOpts {
  out?: string;
  remoteUrl?: string;
  token?: string;
  cwd?: string;
}

export interface ImportOpts {
  in?: string;
  remoteUrl?: string;
  token?: string;
  cwd?: string;
}

export async function runExport(opts: ExportOpts): Promise<void> {
  let dump: HelmDump;
  if (opts.remoteUrl) {
    const res = await fetch(`${trim(opts.remoteUrl)}/v1/admin/export`, {
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    });
    if (!res.ok) throw new Error(`export failed: ${res.status} ${await res.text()}`);
    dump = (await res.json()) as HelmDump;
  } else {
    const repoHandle = await openSharedRepo(opts.cwd ?? process.cwd());
    try {
      dump = await exportAll(repoHandle.repo, SCHEMA_VERSION);
    } finally {
      await repoHandle.close();
    }
  }
  const text = JSON.stringify(dump, null, 2);
  if (opts.out && opts.out !== "-") {
    writeFileSync(opts.out, text, "utf8");
    process.stdout.write(`[helm] wrote ${dump.projects.length} project(s) to ${opts.out}\n`);
  } else {
    process.stdout.write(text + "\n");
  }
}

export async function runImport(opts: ImportOpts): Promise<void> {
  if (!opts.in) throw new Error("--in <file> is required");
  const text = readFileSync(opts.in, "utf8");
  const dump = JSON.parse(text) as HelmDump;
  if (dump.format !== EXPORT_FORMAT_VERSION) {
    throw new Error(`unsupported export format ${dump.format}`);
  }
  if (opts.remoteUrl) {
    const res = await fetch(`${trim(opts.remoteUrl)}/v1/admin/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(dump),
    });
    if (!res.ok) throw new Error(`import failed: ${res.status} ${await res.text()}`);
    const result = (await res.json()) as { projects: number; rows: number };
    process.stdout.write(`[helm] imported ${result.projects} project(s), ${result.rows} row(s)\n`);
    return;
  }
  const repoHandle = await openSharedRepo(opts.cwd ?? process.cwd());
  try {
    const result = await importAll(repoHandle.repo, dump);
    process.stdout.write(`[helm] imported ${result.projects} project(s), ${result.rows} row(s)\n`);
  } finally {
    await repoHandle.close();
  }
}

function trim(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
