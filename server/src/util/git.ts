import { execFileSync } from "node:child_process";

export interface GitProbe {
  isRepo: boolean;
  remoteUrl: string | null;
  userEmail: string | null;
}

function tryGit(args: string[], cwd: string): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function probeGit(cwd: string): GitProbe {
  const insideRepo = tryGit(["rev-parse", "--is-inside-work-tree"], cwd) === "true";
  return {
    isRepo: insideRepo,
    remoteUrl: insideRepo ? tryGit(["remote", "get-url", "origin"], cwd) : null,
    userEmail: insideRepo ? tryGit(["config", "user.email"], cwd) : null,
  };
}

export function repoRoot(cwd: string): string | null {
  return tryGit(["rev-parse", "--show-toplevel"], cwd);
}

export function parseRemoteToSlug(remoteUrl: string): string | null {
  let url = remoteUrl.trim();
  if (url.endsWith(".git")) url = url.slice(0, -4);
  url = url.replace(/^git@([^:]+):/, "https://$1/");
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length < 2) {
      const tail = parts[0];
      return tail ? sanitize(tail) : null;
    }
    const org = parts[parts.length - 2];
    const repo = parts[parts.length - 1];
    if (!org || !repo) return null;
    return sanitize(`${org}-${repo}`);
  } catch {
    return null;
  }
}

function sanitize(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
