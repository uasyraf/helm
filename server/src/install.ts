import { existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

interface HookMatcher {
  matcher: string;
  hooks: HookCommand[];
}

interface StatusLineSetting {
  type: "command";
  command: string;
  padding?: number;
}

interface SettingsShape {
  hooks?: Record<string, HookMatcher[]>;
  statusLine?: StatusLineSetting;
}

const HELM_SESSION_START_TAG = "# helm: SessionStart";
const HELM_POST_TOOL_USE_TAG = "# helm: PostToolUse";
const HELM_STATUSLINE_TAG = "# helm: statusline";

function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return here;
    dir = parent;
  }
}

export function installHooks(settingsPath: string = join(homedir(), ".claude", "settings.json")): {
  installed: string[];
  path: string;
} {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const existing: SettingsShape = existsSync(settingsPath)
    ? (JSON.parse(readFileSync(settingsPath, "utf8")) as SettingsShape)
    : {};
  existing.hooks ??= {};
  existing.hooks.SessionStart ??= [];
  existing.hooks.PostToolUse ??= [];

  const installed: string[] = [];

  if (!hasTag(existing.hooks.SessionStart, HELM_SESSION_START_TAG)) {
    existing.hooks.SessionStart.push({
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: `npx -y @uasyraf/helm banner 2>/dev/null ${HELM_SESSION_START_TAG}`,
          timeout: 5,
        },
      ],
    });
    installed.push("SessionStart");
  }

  if (!hasTag(existing.hooks.PostToolUse, HELM_POST_TOOL_USE_TAG)) {
    existing.hooks.PostToolUse.push({
      matcher: "Edit|Write|MultiEdit",
      hooks: [
        {
          type: "command",
          command: `npx -y @uasyraf/helm hook post-tool-use 2>/dev/null ${HELM_POST_TOOL_USE_TAG}`,
          timeout: 5,
        },
      ],
    });
    installed.push("PostToolUse");
  }

  if (!existing.statusLine || !existing.statusLine.command.includes(HELM_STATUSLINE_TAG)) {
    existing.statusLine = {
      type: "command",
      command: `npx -y @uasyraf/helm banner 2>/dev/null ${HELM_STATUSLINE_TAG}`,
      padding: 0,
    };
    installed.push("statusLine");
  }

  if (installed.length > 0) {
    writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
  }
  return { installed, path: settingsPath };
}

function hasTag(matchers: HookMatcher[], tag: string): boolean {
  return matchers.some((m) => m.hooks.some((h) => h.command.includes(tag)));
}

export function installSkills(skillsRoot: string = join(homedir(), ".claude", "skills")): {
  installed: string[];
  skipped: string[];
} {
  mkdirSync(skillsRoot, { recursive: true });
  const pkgSkillsDir = join(packageRoot(), "skills");
  if (!existsSync(pkgSkillsDir)) return { installed: [], skipped: [] };

  const skills = ["project-tracker", "sprint", "story", "epic", "debt", "backlog", "review", "nelson-integration"];
  const installed: string[] = [];
  const skipped: string[] = [];
  for (const name of skills) {
    const src = join(pkgSkillsDir, name);
    const dst = join(skillsRoot, name);
    if (!existsSync(src)) {
      skipped.push(name);
      continue;
    }
    if (existsSync(dst)) {
      try {
        unlinkSync(dst);
      } catch {
        skipped.push(name);
        continue;
      }
    }
    symlinkSync(src, dst, "dir");
    installed.push(name);
  }
  return { installed, skipped };
}
