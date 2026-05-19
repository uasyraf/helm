import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import { bootstrapSession } from "../src/project/bootstrap.js";
import { buildRestApp } from "../src/http/rest/app.js";

function makeGitRepo(remote: string, dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@helm.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
}

describe("REST scaffold (no auth — stub actor)", () => {
  let home: string;
  let handle: DbHandle;
  let dirA: string;
  let dirB: string;
  let slugA: string;
  let slugB: string;
  let app: ReturnType<typeof buildRestApp>;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "helm-rest-"));
    process.env.HELM_HOME = home;
    handle = await openDb(join(home, "rest.db"));
    const repo = makeSqliteRepo(handle.db);
    dirA = mkdtempSync(join(tmpdir(), "helm-rest-a-"));
    dirB = mkdtempSync(join(tmpdir(), "helm-rest-b-"));
    makeGitRepo("git@github.com:acme/alpha.git", dirA);
    makeGitRepo("git@github.com:acme/beta.git", dirB);
    const sessA = await bootstrapSession(repo, dirA);
    const sessB = await bootstrapSession(repo, dirB);
    slugA = sessA.project.slug;
    slugB = sessB.project.slug;
    app = buildRestApp({ repo });
  });

  afterEach(() => {
    handle.client.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("GET /healthz returns ok", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /v1/projects lists both", async () => {
    const res = await app.request("/v1/projects");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: { slug: string }[] };
    const slugs = body.projects.map((p) => p.slug).sort();
    expect(slugs).toContain(slugA);
    expect(slugs).toContain(slugB);
  });

  it("GET /v1/projects/:slug/status returns sprint snapshot", async () => {
    const res = await app.request(`/v1/projects/${slugA}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { slug: string }; sprint: unknown };
    expect(body.project.slug).toBe(slugA);
    expect(body.sprint).toBeTruthy();
  });

  it("POST /v1/projects/:slug/stories creates and lists isolation between projects", async () => {
    const createA = await app.request(`/v1/projects/${slugA}/stories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "alpha story" }),
    });
    expect(createA.status).toBe(201);

    const createB = await app.request(`/v1/projects/${slugB}/stories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "beta story" }),
    });
    expect(createB.status).toBe(201);

    const backlogA = await app.request(`/v1/projects/${slugA}/stories/backlog`);
    const bodyA = (await backlogA.json()) as { stories: { title: string }[] };
    expect(bodyA.stories.map((s) => s.title)).toEqual(["alpha story"]);

    const backlogB = await app.request(`/v1/projects/${slugB}/stories/backlog`);
    const bodyB = (await backlogB.json()) as { stories: { title: string }[] };
    expect(bodyB.stories.map((s) => s.title)).toEqual(["beta story"]);
  });

  it("POST /v1/projects/:slug/debt + close updates killer metric", async () => {
    const createRes = await app.request(`/v1/projects/${slugA}/debt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "test debt", severity: "high", location: "src/foo.ts:10" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    const statusRes = await app.request(`/v1/projects/${slugA}/status`);
    const status = (await statusRes.json()) as { debt: { open: number; openedThisSprint: number; delta: number } };
    expect(status.debt.open).toBe(1);
    expect(status.debt.openedThisSprint).toBe(1);
    expect(status.debt.delta).toBe(1);

    const closeRes = await app.request(`/v1/projects/${slugA}/debt/${created.id}/close`, { method: "POST" });
    expect(closeRes.status).toBe(200);

    const statusRes2 = await app.request(`/v1/projects/${slugA}/status`);
    const status2 = (await statusRes2.json()) as { debt: { open: number; delta: number } };
    expect(status2.debt.open).toBe(0);
    expect(status2.debt.delta).toBe(0);
  });

  it("404s unknown project slug", async () => {
    const res = await app.request("/v1/projects/does-not-exist/status");
    expect(res.status).toBe(404);
  });

  it("400 on invalid story body", async () => {
    const res = await app.request(`/v1/projects/${slugA}/stories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});
