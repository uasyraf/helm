import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SyncConfig {
  url: string;
  authToken?: string;
  syncIntervalMs?: number;
}

export interface ServerConfig {
  url?: string;
  apiToken?: string;
}

export interface HelmConfig {
  sync: SyncConfig | null;
  server: ServerConfig | null;
}

export function loadConfig(cwd: string): HelmConfig {
  const fromFile = findAndLoadConfigFile(cwd);
  const sync = resolveSync(fromFile?.sync);
  const server = resolveServer(fromFile?.server);
  return { sync, server };
}

function resolveSync(fileSync: Partial<SyncConfig> | undefined): SyncConfig | null {
  const url = process.env.HELM_SYNC_URL ?? fileSync?.url;
  if (!url) return null;
  const authToken = process.env.HELM_SYNC_TOKEN ?? fileSync?.authToken;
  const intervalStr = process.env.HELM_SYNC_INTERVAL_MS;
  const syncIntervalMs = intervalStr ? Number(intervalStr) : fileSync?.syncIntervalMs ?? 5000;
  return { url, authToken, syncIntervalMs };
}

function resolveServer(fileServer: Partial<ServerConfig> | undefined): ServerConfig | null {
  const url = process.env.HELM_SERVER_URL ?? fileServer?.url;
  const apiToken = process.env.HELM_API_TOKEN ?? fileServer?.apiToken;
  if (!url && !apiToken) return null;
  return { url, apiToken };
}

interface FileShape {
  sync?: Partial<SyncConfig>;
  server?: Partial<ServerConfig>;
}

function findAndLoadConfigFile(cwd: string): FileShape | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".helm", "config.json");
    if (existsSync(candidate)) {
      try {
        return JSON.parse(readFileSync(candidate, "utf8")) as FileShape;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
