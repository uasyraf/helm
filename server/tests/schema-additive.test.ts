import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import { bootstrapSessionForProject } from "../src/project/bootstrap.js";
import { newId, now } from "../src/util/ids.js";
import type { Project } from "../src/db/schema.js";

describe("schema additive: developer.oidc_sub + progress_event.user_sub + schema_meta", () => {
  let home: string;
  let handle: DbHandle;
  let project: Project;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "helm-schema-"));
    process.env.HELM_HOME = home;
    handle = await openDb(join(home, "schema.db"));
    const repo = makeSqliteRepo(handle.db);
    project = {
      id: newId(),
      slug: "test-project",
      name: "Test Project",
      gitRemote: null,
      dod: null,
      sprintLengthDays: 14,
      wipEnabled: false,
      estimationEnabled: true,
      createdAt: now(),
    };
    await repo.insertProject(project);
  });

  afterEach(() => {
    handle.client.close();
    rmSync(home, { recursive: true, force: true });
  });

  it("schema_meta stamps version=2 on bootstrap", async () => {
    const row = await handle.client.execute("SELECT value FROM schema_meta WHERE key = 'version'");
    expect(row.rows[0]!.value).toBe("2");
  });

  it("developer table has oidc_sub column", async () => {
    const info = await handle.client.execute("PRAGMA table_info(developer)");
    const cols = info.rows.map((r) => String(r.name));
    expect(cols).toContain("oidc_sub");
  });

  it("progress_event table has user_sub column", async () => {
    const info = await handle.client.execute("PRAGMA table_info(progress_event)");
    const cols = info.rows.map((r) => String(r.name));
    expect(cols).toContain("user_sub");
  });

  it("bootstrapSessionForProject upserts developer by oidcSub when present", async () => {
    const repo = makeSqliteRepo(handle.db);
    const sub = "kc-sub-001";

    const first = await bootstrapSessionForProject(repo, project.slug, {
      handle: "alice",
      email: "alice@example.com",
      userSub: sub,
    });
    expect(first.developer.oidcSub).toBe(sub);

    // Same sub but a different "handle" should resolve to the same developer.
    const second = await bootstrapSessionForProject(repo, project.slug, {
      handle: "alice-new-handle",
      email: "alice@example.com",
      userSub: sub,
    });
    expect(second.developer.id).toBe(first.developer.id);
  });

  it("an existing developer (no sub) gets backfilled when authed user arrives", async () => {
    const repo = makeSqliteRepo(handle.db);

    // First, stdio-style bootstrap with no sub.
    const stdio = await bootstrapSessionForProject(repo, project.slug, {
      handle: "alice",
      email: "alice@example.com",
      userSub: null,
    });
    expect(stdio.developer.oidcSub).toBeNull();

    // Now the same human comes back with an OIDC token.
    const authed = await bootstrapSessionForProject(repo, project.slug, {
      handle: "alice",
      email: "alice@example.com",
      userSub: "kc-sub-001",
    });
    expect(authed.developer.id).toBe(stdio.developer.id);
    expect(authed.developer.oidcSub).toBe("kc-sub-001");
  });

  it("user_sub flows through emitEvent into progress_event rows", async () => {
    const repo = makeSqliteRepo(handle.db);
    const { emitEvent } = await import("../src/events/emit.js");
    await emitEvent(repo, {
      projectId: project.id,
      developerId: null,
      sprintId: null,
      kind: "progress.logged",
      summary: "test",
      userSub: "kc-sub-001",
    });
    const row = await handle.client.execute("SELECT user_sub FROM progress_event WHERE summary = 'test' LIMIT 1");
    expect(row.rows[0]!.user_sub).toBe("kc-sub-001");
  });
});
