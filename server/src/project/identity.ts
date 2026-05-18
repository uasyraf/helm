import { userInfo } from "node:os";
import { probeGit } from "../util/git.js";

export type IdentitySource = "git" | "env-user" | "anonymous";

export interface ResolvedIdentity {
  handle: string;
  email: string | null;
  source: IdentitySource;
  prompt: string | null;
}

export function resolveIdentity(cwd: string): ResolvedIdentity {
  const git = probeGit(cwd);
  if (git.userEmail) {
    return {
      handle: handleFromEmail(git.userEmail),
      email: git.userEmail,
      source: "git",
      prompt: null,
    };
  }

  const envUser = safeUserInfo();
  if (envUser) {
    return {
      handle: envUser,
      email: `${envUser}@local`,
      source: "env-user",
      prompt: null,
    };
  }

  return {
    handle: "anonymous",
    email: null,
    source: "anonymous",
    prompt: "no git user.email or $USER detected — set `git config user.email` or run `helm whoami --set <email>`",
  };
}

function handleFromEmail(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

function safeUserInfo(): string | null {
  try {
    const info = userInfo();
    return info.username || null;
  } catch {
    return null;
  }
}
