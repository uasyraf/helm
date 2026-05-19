import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import { bootstrapSession } from "../src/project/bootstrap.js";
import { buildRestApp } from "../src/http/rest/app.js";
import { exportAll, importAll, EXPORT_FORMAT_VERSION } from "../src/admin/export-import.js";
import { SCHEMA_VERSION } from "../src/db/bootstrap.js";

function makeGitRepo(remote: string, dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@helm.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
}

describe("export / import roundtrip", () => {
  let home: string;
  let handle: DbHandle;
  let dirA: string;
  let dirB: string;
  let slugA: string;
  let slugB: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "helm-exp-"));
    process.env.HELM_HOME = home;
    handle = await openDb(join(home, "src.db"));
    const repo = makeSqliteRepo(handle.db);
    dirA = mkdtempSync(join(tmpdir(), "helm-exp-a-"));
    dirB = mkdtempSync(join(tmpdir(), "helm-exp-b-"));
    makeGitRepo("git@github.com:acme/alpha.git", dirA);
    makeGitRepo("git@github.com:acme/beta.git", dirB);
    const sa = await bootstrapSession(repo, dirA);
    const sb = await bootstrapSession(repo, dirB);
    slugA = sa.project.slug;
    slugB = sb.project.slug;

    const app = buildRestApp({ repo });
    await app.request(`/v1/projects/${slugA}/stories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "alpha story 1" }),
    });
    await app.request(`/v1/projects/${slugB}/debt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "beta debt", location: "src/foo.ts:42" }),
    });
    await app.request(`/v1/projects/${slugA}/decisions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "use postgres", decision: "go with pg" }),
    });
  });

  afterEach(() => {
    handle.client.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("exportAll captures both projects with their rows", async () => {
    const repo = makeSqliteRepo(handle.db);
    const dump = await exportAll(repo, SCHEMA_VERSION);
    expect(dump.format).toBe(EXPORT_FORMAT_VERSION);
    expect(dump.projects).toHaveLength(2);
    const projA = dump.projects.find((p) => p.project.slug === slugA)!;
    const projB = dump.projects.find((p) => p.project.slug === slugB)!;
    expect(projA.stories.map((s) => s.title)).toContain("alpha story 1");
    expect(projB.debt.map((d) => d.title)).toContain("beta debt");
    expect(projA.decisions.map((d) => d.title)).toContain("use postgres");
  });

  it("importAll into a fresh DB yields equivalent state", async () => {
    const sourceRepo = makeSqliteRepo(handle.db);
    const dump = await exportAll(sourceRepo, SCHEMA_VERSION);

    const targetHandle = await openDb(join(home, "target.db"));
    const targetRepo = makeSqliteRepo(targetHandle.db);
    const result = await importAll(targetRepo, dump);
    expect(result.projects).toBe(2);
    expect(result.rows).toBeGreaterThan(0);

    const reExported = await exportAll(targetRepo, SCHEMA_VERSION);
    expect(reExported.projects).toHaveLength(2);
    const titles = reExported.projects.flatMap((p) => p.stories.map((s) => s.title));
    expect(titles).toContain("alpha story 1");
    targetHandle.client.close();
  });

  it("rejects an import dump with a wrong format version", async () => {
    const targetRepo = makeSqliteRepo(handle.db);
    await expect(
      importAll(targetRepo, { format: 999 as 1, schemaVersion: "1", exportedAt: "", projects: [] }),
    ).rejects.toThrow(/unsupported export format/);
  });
});

describe("REST /v1/admin/{export,import} endpoints", () => {
  let home: string;
  let handle: DbHandle;
  let dirA: string;
  let slugA: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "helm-rest-adm-"));
    process.env.HELM_HOME = home;
    handle = await openDb(join(home, "src.db"));
    const repo = makeSqliteRepo(handle.db);
    dirA = mkdtempSync(join(tmpdir(), "helm-rest-adm-a-"));
    makeGitRepo("git@github.com:acme/alpha.git", dirA);
    const sa = await bootstrapSession(repo, dirA);
    slugA = sa.project.slug;
  });

  afterEach(() => {
    handle.client.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dirA, { recursive: true, force: true });
  });

  it("GET /v1/admin/export returns dump under stub-actor (which is admin)", async () => {
    const repo = makeSqliteRepo(handle.db);
    const app = buildRestApp({ repo });
    const res = await app.request("/v1/admin/export");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { format: number; projects: { project: { slug: string } }[] };
    expect(body.format).toBe(EXPORT_FORMAT_VERSION);
    expect(body.projects.map((p) => p.project.slug)).toContain(slugA);
  });

  it("POST /v1/admin/import accepts a valid dump", async () => {
    const repo = makeSqliteRepo(handle.db);
    const app = buildRestApp({ repo });
    const dump = await exportAll(repo, SCHEMA_VERSION);

    // Fresh target
    const targetHome = mkdtempSync(join(tmpdir(), "helm-rest-adm-t-"));
    const target = await openDb(join(targetHome, "t.db"));
    const targetRepo = makeSqliteRepo(target.db);
    const targetApp = buildRestApp({ repo: targetRepo });
    const res = await targetApp.request("/v1/admin/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dump),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    target.client.close();
    rmSync(targetHome, { recursive: true, force: true });
  });
});
