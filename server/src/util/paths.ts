import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export function helmHome(): string {
  if (process.env.HELM_DATA_DIR) return process.env.HELM_DATA_DIR;
  return process.env.HELM_HOME ?? join(homedir(), ".helm");
}

export function unifiedDbPath(): string {
  const explicit = process.env.HELM_DB_PATH;
  if (explicit) {
    ensureDir(explicit.slice(0, explicit.lastIndexOf("/")));
    return explicit;
  }
  const home = helmHome();
  ensureDir(home);
  return join(home, "helm.db");
}

export function legacyDbPathFor(slug: string): string {
  return join(helmHome(), `${slug}.db`);
}

function ensureDir(path: string): void {
  if (!path) return;
  try {
    mkdirSync(path, { recursive: true });
  } catch {
    /* best effort */
  }
}
