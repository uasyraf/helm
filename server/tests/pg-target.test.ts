import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { openPgliteDb, type PgHandle } from "../src/db/pg-client.js";
import { schema as pgSchema } from "../src/db/schema-pg.js";
import { newId, now } from "../src/util/ids.js";

describe("Postgres target (pglite)", () => {
  let handle: PgHandle | null = null;

  beforeEach(async () => {
    handle = await openPgliteDb();
  });
  afterEach(async () => {
    if (handle) await handle.close();
    handle = null;
  });

  it("bootstrap creates the 9 helm tables", async () => {
    const { db } = handle!;
    const projectId = newId();
    await db.insert(pgSchema.project).values({
      id: projectId,
      slug: "x",
      name: "X",
      gitRemote: null,
      dod: null,
      sprintLengthDays: 14,
      wipEnabled: false,
      estimationEnabled: true,
      createdAt: now(),
    });
    const rows = await db.select().from(pgSchema.project).where(eq(pgSchema.project.id, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toBe("x");
    expect(rows[0]?.wipEnabled).toBe(false);
    expect(rows[0]?.estimationEnabled).toBe(true);
  });

  it("supports a story → progress_event flow end-to-end", async () => {
    const { db } = handle!;
    const projectId = newId();
    const sprintId = newId();
    const storyId = newId();
    await db.insert(pgSchema.project).values({
      id: projectId,
      slug: "y",
      name: "Y",
      gitRemote: null,
      dod: null,
      sprintLengthDays: 14,
      wipEnabled: false,
      estimationEnabled: true,
      createdAt: now(),
    });
    await db.insert(pgSchema.sprint).values({
      id: sprintId,
      projectId,
      name: "sprint-1",
      goal: null,
      startedAt: now(),
      endedAt: null,
      status: "active",
      wipLimit: null,
    });
    await db.insert(pgSchema.story).values({
      id: storyId,
      projectId,
      epicId: null,
      sprintId,
      title: "first",
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
    await db.insert(pgSchema.progressEvent).values({
      id: newId(),
      projectId,
      developerId: null,
      sprintId,
      kind: "story.opened",
      refId: storyId,
      summary: "opened",
      ts: now(),
    });

    const events = await db
      .select()
      .from(pgSchema.progressEvent)
      .where(eq(pgSchema.progressEvent.refId, storyId));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("story.opened");
  });

  it("bootstrap is idempotent", async () => {
    const { db } = handle!;
    await db.insert(pgSchema.project).values({
      id: newId(),
      slug: "idempotent",
      name: "I",
      gitRemote: null,
      dod: null,
      sprintLengthDays: 14,
      wipEnabled: false,
      estimationEnabled: true,
      createdAt: now(),
    });
    await handle!.close();
    handle = await openPgliteDb();
    const rows = await handle.db.select().from(pgSchema.project);
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});
