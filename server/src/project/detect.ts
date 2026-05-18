import { basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { probeGit, repoRoot, parseRemoteToSlug } from "../util/git.js";

export type SlugSource = "remote" | "cwd-with-git" | "cwd-no-git" | "override";

export interface DetectedProject {
  slug: string;
  name: string;
  gitRemote: string | null;
  source: SlugSource;
  warning: string | null;
  rootDir: string;
}

interface ProjectOverride {
  slug?: string;
  name?: string;
}

function loadOverride(cwd: string): { override: ProjectOverride; rootDir: string } | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".helm", "project.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as ProjectOverride;
        return { override: parsed, rootDir: dir };
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function detectProject(cwd: string): DetectedProject {
  const override = loadOverride(cwd);
  const git = probeGit(cwd);
  const baseDir = override?.rootDir ?? repoRoot(cwd) ?? cwd;
  const cwdName = sanitize(basename(baseDir));

  if (override?.override.slug) {
    return {
      slug: override.override.slug,
      name: override.override.name ?? override.override.slug,
      gitRemote: git.remoteUrl,
      source: "override",
      warning: null,
      rootDir: override.rootDir,
    };
  }

  if (git.remoteUrl) {
    const slug = parseRemoteToSlug(git.remoteUrl);
    if (slug) {
      return {
        slug,
        name: humanize(slug),
        gitRemote: git.remoteUrl,
        source: "remote",
        warning: null,
        rootDir: baseDir,
      };
    }
  }

  if (git.isRepo) {
    return {
      slug: cwdName,
      name: humanize(cwdName),
      gitRemote: null,
      source: "cwd-with-git",
      warning: "no git remote configured — using directory name as slug",
      rootDir: baseDir,
    };
  }

  return {
    slug: cwdName,
    name: humanize(cwdName),
    gitRemote: null,
    source: "cwd-no-git",
    warning: "not a git repo — using directory name. Run `helm init --slug <name>` to override.",
    rootDir: baseDir,
  };
}

function sanitize(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "project";
}

function humanize(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
