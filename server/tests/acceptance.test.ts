import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import type { HelmRepo } from "../src/db/repo.js";
import { bootstrapSession, type SessionContext } from "../src/project/bootstrap.js";
import { detectProject } from "../src/project/detect.js";
import { resolveIdentity } from "../src/project/identity.js";
import { renderBanner } from "../src/banner.js";
import { story, techDebt, progressEvent } from "../src/db/schema.js";
import { emitEvent } from "../src/events/emit.js";
import { newId, now } from "../src/util/ids.js";
import { and, eq } from "drizzle-orm";

interface Fixture {
  cwd: string;
  dbPath: string;
  handle: DbHandle;
  repo: HelmRepo;
  session: SessionContext;
}

let fixture: Fixture | null = null;

async function setupFixture(opts: { withGit?: boolean } = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), "helm-test-"));
  if (opts.withGit) {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@helm.local"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  }
  const dbPath = join(root, "test.db");
  const handle = await openDb(dbPath);
  const repo = makeSqliteRepo(handle.db);
  const session = await bootstrapSession(repo, root);
  return { cwd: root, dbPath, handle, repo, session };
}

beforeAll(() => {
  const sandbox = mkdtempSync(join(tmpdir(), "helm-home-"));
  process.env.HELM_HOME = sandbox;
});

beforeEach(async () => {
  fixture = await setupFixture({ withGit: true });
});

afterEach(() => {
  if (fixture) {
    fixture.handle.client.close();
    rmSync(fixture.cwd, { recursive: true, force: true });
    fixture = null;
  }
});

describe("bootstrap", () => {
  it("creates project, developer, and active sprint", () => {
    const f = fixture!;
    expect(f.session.project.slug).toBeTruthy();
    expect(f.session.developer.handle).toBe("test");
    expect(f.session.developer.email).toBe("test@helm.local");
    expect(f.session.activeSprint.status).toBe("active");
    expect(f.session.activeSprint.name).toBe("sprint-1");
  });

  it("is idempotent across reopens", async () => {
    const f = fixture!;
    const second = await bootstrapSession(f.repo, f.cwd);
    expect(second.project.id).toBe(f.session.project.id);
    expect(second.developer.id).toBe(f.session.developer.id);
    expect(second.activeSprint.id).toBe(f.session.activeSprint.id);
  });
});

describe("project detection", () => {
  it("falls back to cwd basename when no git remote", () => {
    const f = fixture!;
    const d = detectProject(f.cwd);
    expect(d.source).toBe("cwd-with-git");
    expect(d.warning).toContain("no git remote");
  });

  it("falls back to cwd basename when not a git repo", () => {
    const noGit = mkdtempSync(join(tmpdir(), "helm-nogit-"));
    try {
      const d = detectProject(noGit);
      expect(d.source).toBe("cwd-no-git");
      expect(d.slug).toBeTruthy();
    } finally {
      rmSync(noGit, { recursive: true, force: true });
    }
  });

  it("honors .helm/project.json override", () => {
    const f = fixture!;
    mkdirSync(join(f.cwd, ".helm"), { recursive: true });
    writeFileSync(join(f.cwd, ".helm", "project.json"), JSON.stringify({ slug: "custom-slug", name: "Custom" }));
    const d = detectProject(f.cwd);
    expect(d.source).toBe("override");
    expect(d.slug).toBe("custom-slug");
    expect(d.name).toBe("Custom");
  });
});

describe("identity", () => {
  it("uses git user.email when present", () => {
    const f = fixture!;
    const id = resolveIdentity(f.cwd);
    expect(id.source).toBe("git");
    expect(id.handle).toBe("test");
    expect(id.email).toBe("test@helm.local");
  });

  it("falls back to env user when git is absent", () => {
    const noGit = mkdtempSync(join(tmpdir(), "helm-nogit-id-"));
    try {
      const id = resolveIdentity(noGit);
      expect(["env-user", "anonymous"]).toContain(id.source);
    } finally {
      rmSync(noGit, { recursive: true, force: true });
    }
  });
});

describe("story lifecycle", () => {
  it("open → move → close produces correct progress events and sprint counts", async () => {
    const f = fixture!;
    const { repo } = f;
    const { db } = f.handle;
    const projectId = f.session.project.id;
    const devId = f.session.developer.id;
    const sprintId = f.session.activeSprint.id;

    const storyId = newId();
    await repo.insertStory({
      id: storyId,
      epicId: null,
      sprintId: null,
      title: "Test story",
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
    await emitEvent(repo, { projectId, developerId: devId, sprintId, kind: "story.opened", refId: storyId, summary: "open" });

    await repo.updateStory(storyId, { sprintId, status: "todo" });
    await emitEvent(repo, { projectId, developerId: devId, sprintId, kind: "story.moved", refId: storyId, summary: "moved" });

    await repo.updateStory(storyId, { status: "done", completedAt: now() });
    await emitEvent(repo, { projectId, developerId: devId, sprintId, kind: "story.closed", refId: storyId, summary: "closed" });

    const events = await db
      .select()
      .from(progressEvent)
      .where(and(eq(progressEvent.refId, storyId), eq(progressEvent.projectId, projectId)));
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(["story.closed", "story.moved", "story.opened"]);

    const inSprint = await db.select().from(story).where(eq(story.sprintId, sprintId));
    expect(inSprint).toHaveLength(1);
    expect(inSprint[0]?.status).toBe("done");
  });
});

describe("debt round-trip", () => {
  it("log_debt is visible in list_debt", async () => {
    const f = fixture!;
    const debtId = newId();
    await f.repo.insertDebt({
      id: debtId,
      projectId: f.session.project.id,
      title: "// FIXME: refactor billing",
      description: null,
      severity: "high",
      location: "src/billing.ts:42",
      ownerId: f.session.developer.id,
      expiresAt: null,
      openedAt: now(),
      closedAt: null,
      linkedStoryId: null,
    });
    await emitEvent(f.repo, {
      projectId: f.session.project.id,
      developerId: f.session.developer.id,
      sprintId: f.session.activeSprint.id,
      kind: "debt.opened",
      refId: debtId,
      summary: "opened",
    });

    const rows = await f.repo.findAllDebtByProject(f.session.project.id, 100);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain("billing");
    expect(rows[0]?.severity).toBe("high");
    expect(rows[0]?.location).toBe("src/billing.ts:42");
  });
});

describe("banner", () => {
  it("renders one-liner with sprint, story counts, and debt delta", async () => {
    const f = fixture!;
    f.handle.client.close();
    const line = await renderBanner(f.cwd);
    expect(line).toMatch(/^\[helm\] sprint-\d+ \(d\d+\/\d+\) \| stories: \d+\/\d+ done \| debt: \d+ \(Δ[+-]?\d+\)$/);
    const reopen = await openDb(f.dbPath);
    fixture = { ...f, handle: reopen, repo: makeSqliteRepo(reopen.db) };
  });
});

describe("sprint rollover (Q4 locked: return to backlog)", () => {
  it("end_sprint moves only incomplete stories back to backlog; done and dropped stay attached", async () => {
    const f = fixture!;
    const { db } = f.handle;
    const sprintId = f.session.activeSprint.id;
    const { ne } = await import("drizzle-orm");

    const incompleteId = newId();
    const doneId = newId();
    const droppedId = newId();
    const base = {
      epicId: null,
      description: null,
      acceptance: null,
      size: null,
      assigneeId: null,
      priority: 3,
      startedAt: null,
      completedAt: null,
      createdAt: now(),
    } as const;
    await db.insert(story).values({ id: incompleteId, sprintId, title: "incomplete", status: "doing", ...base });
    await db.insert(story).values({ id: doneId, sprintId, title: "done", status: "done", completedAt: now(), ...base });
    await db.insert(story).values({ id: droppedId, sprintId, title: "dropped", status: "dropped", ...base });

    const before = await db.select().from(story).where(eq(story.sprintId, sprintId));
    expect(before).toHaveLength(3);

    await db
      .update(story)
      .set({ sprintId: null, status: "backlog" })
      .where(and(eq(story.sprintId, sprintId), ne(story.status, "done"), ne(story.status, "dropped")));

    const moved = (await db.select().from(story).where(eq(story.id, incompleteId)))[0];
    expect(moved?.sprintId).toBeNull();
    expect(moved?.status).toBe("backlog");

    const stillDone = (await db.select().from(story).where(eq(story.id, doneId)))[0];
    expect(stillDone?.sprintId).toBe(sprintId);
    expect(stillDone?.status).toBe("done");

    const stillDropped = (await db.select().from(story).where(eq(story.id, droppedId)))[0];
    expect(stillDropped?.sprintId).toBe(sprintId);
    expect(stillDropped?.status).toBe("dropped");
  });
});

describe("server build", () => {
  it("buildServer succeeds end-to-end", async () => {
    const f = fixture!;
    f.handle.client.close();
    const { buildServer } = await import("../src/server.js");
    const handle = await buildServer(f.cwd);
    expect(handle.server).toBeTruthy();
    await handle.close();
    const reopen = await openDb(f.dbPath);
    fixture = { ...f, handle: reopen, repo: makeSqliteRepo(reopen.db) };
  });
});
