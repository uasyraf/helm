import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import { bootstrapSession } from "../src/project/bootstrap.js";
import { newId, now } from "../src/util/ids.js";
import { runMigrate } from "../src/migrate.js";

function makeGitRepo(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), "helm-multi-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@helm.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  return dir;
}

describe("multi-project in a single DB", () => {
  let helmHome: string;
  let dbPath: string;
  let handle: DbHandle;

  beforeEach(async () => {
    helmHome = mkdtempSync(join(tmpdir(), "helm-home-multi-"));
    process.env.HELM_HOME = helmHome;
    dbPath = join(helmHome, "helm.db");
    handle = await openDb(dbPath);
  });

  afterEach(() => {
    handle.client.close();
    rmSync(helmHome, { recursive: true, force: true });
  });

  it("isolates backlog stories per project", async () => {
    const repo = makeSqliteRepo(handle.db);
    const dirA = makeGitRepo("git@github.com:acme/alpha.git");
    const dirB = makeGitRepo("git@github.com:acme/beta.git");
    try {
      const sessA = await bootstrapSession(repo, dirA);
      const sessB = await bootstrapSession(repo, dirB);
      expect(sessA.project.slug).not.toBe(sessB.project.slug);

      // Add a backlog story to each project
      await repo.insertStory({
        id: newId(),
        projectId: sessA.project.id,
        epicId: null,
        sprintId: null,
        title: "alpha-backlog",
        description: null,
        acceptance: null,
        status: "backlog",
        size: null,
        assigneeId: null,
        priority: 3,
        startedAt: null,
        completedAt: null,
        createdAt: now(),
      });
      await repo.insertStory({
        id: newId(),
        projectId: sessB.project.id,
        epicId: null,
        sprintId: null,
        title: "beta-backlog",
        description: null,
        acceptance: null,
        status: "backlog",
        size: null,
        assigneeId: null,
        priority: 3,
        startedAt: null,
        completedAt: null,
        createdAt: now(),
      });

      const backlogA = await repo.findBacklogStories(sessA.project.id, 100);
      const backlogB = await repo.findBacklogStories(sessB.project.id, 100);
      expect(backlogA.map((s) => s.title)).toEqual(["alpha-backlog"]);
      expect(backlogB.map((s) => s.title)).toEqual(["beta-backlog"]);

      const countA = await repo.countBacklog(sessA.project.id);
      const countB = await repo.countBacklog(sessB.project.id);
      expect(countA).toBe(1);
      expect(countB).toBe(1);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});

describe("helm migrate", () => {
  let helmHome: string;

  beforeEach(() => {
    helmHome = mkdtempSync(join(tmpdir(), "helm-home-migrate-"));
    process.env.HELM_HOME = helmHome;
  });

  afterEach(() => {
    rmSync(helmHome, { recursive: true, force: true });
  });

  it("merges legacy per-slug DBs into unified helm.db", async () => {
    const legacyA = join(helmHome, "alpha.db");
    const legacyB = join(helmHome, "beta.db");
    for (const path of [legacyA, legacyB]) {
      const dh = await openDb(path);
      const repo = makeSqliteRepo(dh.db);
      const dir = makeGitRepo(`git@github.com:acme/${path.endsWith("alpha.db") ? "alpha" : "beta"}.git`);
      try {
        await bootstrapSession(repo, dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
        dh.client.close();
      }
    }

    const result = await runMigrate();
    expect(result.merged.map((m) => m.slug).sort()).toEqual(["acme-alpha", "acme-beta"]);

    const unified = await openDb(join(helmHome, "helm.db"));
    const repo = makeSqliteRepo(unified.db);
    const projects = await repo.findAllProjects();
    expect(projects.map((p) => p.slug).sort()).toEqual(["acme-alpha", "acme-beta"]);
    unified.client.close();
  });

  it("skips legacy DBs whose slug already exists in unified DB", async () => {
    const unifiedPath = join(helmHome, "helm.db");
    const legacy = join(helmHome, "alpha.db");
    for (const path of [unifiedPath, legacy]) {
      const dh = await openDb(path);
      const repo = makeSqliteRepo(dh.db);
      const dir = makeGitRepo("git@github.com:acme/alpha.git");
      try {
        await bootstrapSession(repo, dir);
      } finally {
        rmSync(dir, { recursive: true, force: true });
        dh.client.close();
      }
    }
    const result = await runMigrate();
    expect(result.skipped.map((s) => s.source)).toContain("alpha.db");
    expect(result.merged.length).toBe(0);
  });
});

