import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { repoRoot } from "./util/git.js";

export interface InitOptions {
  team: boolean;
  syncUrl?: string;
  syncToken?: string;
  cwd?: string;
  nonInteractive?: boolean;
}

export interface InitResult {
  configPath: string;
  wrote: boolean;
}

export async function runInit(opts: InitOptions): Promise<InitResult> {
  const cwd = opts.cwd ?? process.cwd();
  const root = repoRoot(cwd) ?? cwd;
  const helmDir = join(root, ".helm");
  const configPath = join(helmDir, "config.json");

  if (!opts.team) {
    return { configPath, wrote: false };
  }

  let syncUrl = opts.syncUrl;
  let syncToken = opts.syncToken;

  if (!opts.nonInteractive && !syncUrl) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      stdout.write("helm init --team\n");
      stdout.write("---\n");
      stdout.write("Configure shared sync so teammates running `npx -y @uasyraf/helm` auto-pick it up.\n\n");
      syncUrl = (await rl.question("Turso sync URL (libsql://...): ")).trim();
      if (!syncUrl) {
        stdout.write("aborted: no sync URL provided\n");
        return { configPath, wrote: false };
      }
      syncToken = (await rl.question("Auth token (optional, blank for none): ")).trim() || undefined;
    } finally {
      rl.close();
    }
  }

  if (!syncUrl) {
    throw new Error("--sync-url required in non-interactive mode");
  }

  mkdirSync(helmDir, { recursive: true });
  const existing = readExisting(configPath);
  const next = {
    ...existing,
    sync: {
      ...(existing.sync ?? {}),
      url: syncUrl,
      ...(syncToken ? { authToken: syncToken } : {}),
    },
  };
  writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  return { configPath, wrote: true };
}

function readExisting(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}
