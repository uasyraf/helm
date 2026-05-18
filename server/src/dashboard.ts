import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectProject } from "./project/detect.js";
import { dbPathFor } from "./util/paths.js";
import { openDb } from "./db/client.js";
import { bootstrapSession } from "./project/bootstrap.js";

function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  while (true) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "dashboard"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return here;
    dir = parent;
  }
}

export interface DashboardOptions {
  dev: boolean;
  cwd?: string;
}

export async function runDashboard(opts: DashboardOptions): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const detected = detectProject(cwd);
  const dbPath = dbPathFor(detected.slug);
  const handle = await openDb(dbPath);
  await bootstrapSession(handle.db, cwd);
  handle.client.close();

  const dashboardDir = join(packageRoot(), "dashboard");
  if (!existsSync(dashboardDir)) {
    throw new Error(`dashboard directory not found at ${dashboardDir}`);
  }

  const env = {
    ...process.env,
    HELM_PROJECT_SLUG: detected.slug,
    HOST: process.env.HELM_DASHBOARD_HOST ?? "127.0.0.1",
    PORT: process.env.HELM_DASHBOARD_PORT ?? "4400",
  };
  const stdio: SpawnOptions["stdio"] = "inherit";

  if (opts.dev) {
    return await spawnAndWait("npm", ["run", "dev"], { cwd: dashboardDir, env, stdio });
  }

  const buildEntry = join(dashboardDir, "build", "index.js");
  if (!existsSync(buildEntry)) {
    const buildExit = await spawnAndWait("npm", ["run", "build"], { cwd: dashboardDir, env, stdio });
    if (buildExit !== 0) return buildExit;
  }
  return await spawnAndWait(process.execPath, [buildEntry], { env, stdio });
}

function spawnAndWait(cmd: string, args: string[], opts: SpawnOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}
