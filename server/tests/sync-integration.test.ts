import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import { bootstrapSession, type SessionContext } from "../src/project/bootstrap.js";
import { story, progressEvent } from "../src/db/schema.js";
import { newId, now } from "../src/util/ids.js";
import { emitEvent } from "../src/events/emit.js";
import { eq } from "drizzle-orm";

const SYNC_URL = process.env.HELM_SYNC_TEST_URL ?? "http://127.0.0.1:18080";
const SHOULD_RUN = process.env.HELM_INTEGRATION === "1";

const describeIf = SHOULD_RUN ? describe : describe.skip;

describeIf("multi-dev sync (sqld integration)", () => {
  const namespace = `helm-test-${Date.now()}-${process.pid}`;
  let resetClient: Client | null = null;

  beforeAll(async () => {
    resetClient = createClient({ url: SYNC_URL });
    for (const t of ["progress_event", "task", "tech_debt", "decision", "story", "epic", "sprint", "developer", "project"]) {
      try {
        await resetClient.execute(`DROP TABLE IF EXISTS ${t}`);
      } catch {
        // ignore
      }
    }
  });

  afterAll(() => {
    if (resetClient) resetClient.close();
  });

  it("writes from dev A reach dev B's local replica within 10s", async () => {
    const cwd = mkdtempSync(join(tmpdir(), `${namespace}-cwd-`));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "shared@helm.local"], { cwd });
    execFileSync("git", ["config", "user.name", "Shared"], { cwd });

    const devADir = mkdtempSync(join(tmpdir(), `${namespace}-A-`));
    const devBDir = mkdtempSync(join(tmpdir(), `${namespace}-B-`));

    let handleA: DbHandle | null = null;
    let handleB: DbHandle | null = null;
    try {
      handleA = await openDb(join(devADir, "db.sqlite"), {
        sync: { url: SYNC_URL, syncIntervalMs: 1000 },
      });
      const repoA = makeSqliteRepo(handleA.db);
      const sessionA: SessionContext = await bootstrapSession(repoA, cwd);
      await handleA.sync?.();

      const storyId = newId();
      await repoA.insertStory({
        id: storyId,
        projectId: sessionA.project.id,
        epicId: null,
        sprintId: sessionA.activeSprint.id,
        title: "Synced story from dev A",
        description: null,
        acceptance: null,
        status: "todo",
        size: null,
        assigneeId: null,
        priority: 3,
        startedAt: null,
        completedAt: null,
        createdAt: now(),
      });
      await emitEvent(repoA, {
        projectId: sessionA.project.id,
        developerId: sessionA.developer.id,
        sprintId: sessionA.activeSprint.id,
        kind: "story.opened",
        refId: storyId,
        summary: "from dev A",
      });
      await handleA.sync?.();

      handleB = await openDb(join(devBDir, "db.sqlite"), {
        sync: { url: SYNC_URL, syncIntervalMs: 1000 },
      });

      const deadline = Date.now() + 10_000;
      let seen: typeof story.$inferSelect | null = null;
      while (Date.now() < deadline) {
        await handleB.sync?.();
        const rows = await handleB.db.select().from(story).where(eq(story.id, storyId));
        if (rows[0]) {
          seen = rows[0];
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(seen).not.toBeNull();
      expect(seen?.title).toBe("Synced story from dev A");

      const events = await handleB.db
        .select()
        .from(progressEvent)
        .where(eq(progressEvent.refId, storyId));
      expect(events.length).toBeGreaterThanOrEqual(1);
    } finally {
      handleA?.client.close();
      handleB?.client.close();
      rmSync(devADir, { recursive: true, force: true });
      rmSync(devBDir, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
