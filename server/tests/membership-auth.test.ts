import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import { pendingSession } from "../src/project/bootstrap.js";
import { buildRestApp } from "../src/http/rest/app.js";
import { buildServer } from "../src/server.js";
import type { RestActor, RestMiddleware } from "../src/http/rest/context.js";
import type { HelmRepo } from "../src/db/repo.js";
import { newId, now } from "../src/util/ids.js";

// Programmable actor injector — every test sets actor, then makes requests.
// This is the same shape stub-auth produces but lets us flip userSub / claim /
// admin per-test without standing up a JWT verifier.
interface ActorOverrides {
  userSub: string | null;
  handle: string;
  email?: string | null;
  isAdmin?: boolean;
  allowedProjects?: ReadonlySet<string> | "all";
}

function makeActorMiddleware(getActor: () => ActorOverrides): RestMiddleware {
  return async (c, next) => {
    const a = getActor();
    const actor: RestActor = {
      developerId: null,
      userSub: a.userSub,
      handle: a.handle,
      email: a.email ?? null,
      isAdmin: a.isAdmin ?? false,
      allowedProjects: a.allowedProjects ?? new Set<string>(),
    };
    c.set("actor", actor);
    await next();
  };
}

interface ToolReply {
  isError?: boolean;
  content: { type: string; text: string }[];
}

async function callTool(
  server: import("../src/server.js").ServerHandle,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolReply> {
  const tool = (server.server as unknown as {
    _registeredTools: Record<string, { handler: (a: Record<string, unknown>, extra: unknown) => Promise<ToolReply> }>;
  })._registeredTools[name];
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.handler(args, {});
}

// Seed a legacy (closed) project directly via the repo, bypassing the REST
// path that now defaults openJoin=true. Used to exercise the bare FORBIDDEN
// branch on MCP set_active_project.
async function seedClosedProject(repo: HelmRepo, slug: string, name: string): Promise<{ id: string; slug: string }> {
  const id = newId();
  await repo.insertProject({
    id,
    slug,
    name,
    gitRemote: null,
    dod: null,
    sprintLengthDays: 14,
    wipEnabled: false,
    estimationEnabled: true,
    openJoin: false,
    createdAt: now(),
  });
  return { id, slug };
}

describe("friendly project provisioning — REST + MCP auth path", () => {
  let home: string;
  let handle: DbHandle;
  let repo: HelmRepo;
  let actor: ActorOverrides;
  let app: ReturnType<typeof buildRestApp>;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "helm-mem-"));
    process.env.HELM_HOME = home;
    handle = await openDb(join(home, "mem.db"));
    repo = makeSqliteRepo(handle.db);
    // Default: a never-set actor surfaces as anonymous-no-userSub. Each test
    // overwrites this before issuing requests.
    actor = { userSub: null, handle: "anonymous" };
    app = buildRestApp({ repo, authMiddleware: makeActorMiddleware(() => actor) });
  });

  afterEach(() => {
    handle.client.close();
    rmSync(home, { recursive: true, force: true });
  });

  // CASE 1 — authenticated non-admin creates a project
  it("case 1: authenticated non-admin creates a project (201 + openJoin=true + owner membership row)", async () => {
    actor = { userSub: "sub-alice", handle: "alice" };
    const res = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha Project" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; slug: string; name: string; openJoin: boolean; createdAt: string };
    expect(body.slug).toBe("alpha");
    expect(body.name).toBe("Alpha Project");
    expect(body.openJoin).toBe(true);
    expect(typeof body.id).toBe("string");
    expect(typeof body.createdAt).toBe("string");

    // Verify owner membership row via repo (not via HTTP — proves the round-trip
    // really persisted).
    const member = await repo.findProjectMember(body.id, "sub-alice");
    expect(member).not.toBeNull();
    expect(member?.role).toBe("owner");
    expect(member?.userSub).toBe("sub-alice");
  });

  // Auxiliary: 401 path (no userSub) — guard documented by T4
  it("case 1b: anonymous (no userSub) POST /v1/projects → 401 UNAUTHORIZED", async () => {
    actor = { userSub: null, handle: "anonymous" };
    const res = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "anon-attempt" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("authenticated identity required");
    // And nothing inserted
    expect(await repo.findProjectBySlug("anon-attempt")).toBeNull();
  });

  // CASE 2 — creator binds via MCP set_active_project on their own project
  it("case 2: creator binds via set_active_project on the project they created", async () => {
    // Create via REST as alice
    actor = { userSub: "sub-alice", handle: "alice" };
    const createRes = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha" }),
    });
    expect(createRes.status).toBe(201);

    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: null, userSub: "sub-alice" },
      allowedProjects: new Set<string>(), // empty claim — membership must cover
    });
    const reply = await callTool(server, "set_active_project", { slug: "alpha" });
    expect(reply.isError).toBeFalsy();
    const parsed = JSON.parse(reply.content[0]!.text) as { project: { slug: string }; sprint: { id: string }; developer: { handle: string } };
    expect(parsed.project.slug).toBe("alpha");
    expect(parsed.developer.handle).toBe("alice");
    await server.close();
  });

  // CASE 3 — second user without claim, open project → JOIN_REQUIRED
  it("case 3: second user without claim against open project → JOIN_REQUIRED payload", async () => {
    // Alice creates
    actor = { userSub: "sub-alice", handle: "alice" };
    const createRes = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha Project" }),
    });
    expect(createRes.status).toBe(201);

    // Bob, no claim, no membership
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "bob", email: null, userSub: "sub-bob" },
      allowedProjects: new Set<string>(),
    });
    const reply = await callTool(server, "set_active_project", { slug: "alpha" });
    expect(reply.isError).toBe(true);
    const parsed = JSON.parse(reply.content[0]!.text) as {
      error: { code: string; message: string; joinable?: { slug: string; name: string; open_join: boolean } };
    };
    expect(parsed.error.code).toBe("JOIN_REQUIRED");
    expect(parsed.error.joinable).toBeDefined();
    expect(parsed.error.joinable?.slug).toBe("alpha");
    expect(parsed.error.joinable?.name).toBe("Alpha Project");
    expect(parsed.error.joinable?.open_join).toBe(true);
    await server.close();
  });

  // CASE 4 — second user calls POST /:slug/join, then set_active_project succeeds
  it("case 4: second user joins via REST then set_active_project succeeds", async () => {
    // Alice creates
    actor = { userSub: "sub-alice", handle: "alice" };
    const createRes = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha" }),
    });
    const created = (await createRes.json()) as { id: string };

    // Bob joins
    actor = { userSub: "sub-bob", handle: "bob" };
    const joinRes = await app.request("/v1/projects/alpha/join", { method: "POST" });
    expect(joinRes.status).toBe(201);
    const joinBody = (await joinRes.json()) as { slug: string; role: string; alreadyMember: boolean };
    expect(joinBody.slug).toBe("alpha");
    expect(joinBody.role).toBe("member");
    expect(joinBody.alreadyMember).toBe(false);

    // Membership persisted
    const member = await repo.findProjectMember(created.id, "sub-bob");
    expect(member).not.toBeNull();
    expect(member?.role).toBe("member");

    // set_active_project now succeeds for Bob
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "bob", email: null, userSub: "sub-bob" },
      allowedProjects: new Set<string>(),
    });
    const reply = await callTool(server, "set_active_project", { slug: "alpha" });
    expect(reply.isError).toBeFalsy();
    const parsed = JSON.parse(reply.content[0]!.text) as { project: { slug: string } };
    expect(parsed.project.slug).toBe("alpha");
    await server.close();
  });

  // CASE 5 — third user against a closed (legacy) project → bare FORBIDDEN, NOT JOIN_REQUIRED
  it("case 5: closed (legacy) project → set_active_project returns bare FORBIDDEN (no joinable payload)", async () => {
    // Seed a closed project directly — REST always creates openJoin=true now,
    // so the only way to materialize a legacy closed project is via the repo.
    await seedClosedProject(repo, "legacy", "Legacy Closed");

    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "carol", email: null, userSub: "sub-carol" },
      allowedProjects: new Set<string>(),
    });
    const reply = await callTool(server, "set_active_project", { slug: "legacy" });
    expect(reply.isError).toBe(true);
    const parsed = JSON.parse(reply.content[0]!.text) as {
      error: { code: string; message: string; joinable?: unknown };
    };
    expect(parsed.error.code).toBe("FORBIDDEN");
    expect(parsed.error.message).toBe("no access to project 'legacy'");
    expect(parsed.error.joinable).toBeUndefined();
    await server.close();

    // REST mirror: scoped route must 403 too (no membership, no claim, regardless of openJoin)
    actor = { userSub: "sub-carol", handle: "carol" };
    const restRes = await app.request("/v1/projects/legacy/status");
    expect(restRes.status).toBe(403);
  });

  // CASE 6 — claim path still works (regression guard) for REST and MCP
  it("case 6: user with helm_projects claim (no membership) accesses project via claim — REST + MCP", async () => {
    // Seed two projects: one open (alpha), one closed (legacy). The claim
    // should cover both regardless of openJoin or membership.
    actor = { userSub: "sub-alice", handle: "alice" };
    const createRes = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha" }),
    });
    expect(createRes.status).toBe(201);
    await seedClosedProject(repo, "legacy", "Legacy");

    // Bob — no membership, but claim covers both. REST must 200 without a
    // membership-table hit (the claimCovers fast-path in project-loader).
    actor = {
      userSub: "sub-bob",
      handle: "bob",
      allowedProjects: new Set(["alpha", "legacy"]),
    };
    const restAlpha = await app.request("/v1/projects/alpha/status");
    expect(restAlpha.status).toBe(200);
    const restLegacy = await app.request("/v1/projects/legacy/status");
    expect(restLegacy.status).toBe(200);

    // Confirm NO membership row was inserted as a side effect.
    const alphaRow = await repo.findProjectBySlug("alpha");
    expect(alphaRow).not.toBeNull();
    const bobAlphaMember = await repo.findProjectMember(alphaRow!.id, "sub-bob");
    expect(bobAlphaMember).toBeNull();

    // MCP mirror — claim-only access succeeds.
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "bob", email: null, userSub: "sub-bob" },
      allowedProjects: new Set(["alpha", "legacy"]),
    });
    const reply = await callTool(server, "set_active_project", { slug: "legacy" });
    expect(reply.isError).toBeFalsy();
    const parsed = JSON.parse(reply.content[0]!.text) as { project: { slug: string } };
    expect(parsed.project.slug).toBe("legacy");
    await server.close();
  });

  // CASE 7 — admin bypass (regression guard) for REST and MCP
  it("case 7: helm-admin (allowedProjects=all) bypasses join gate on REST and MCP", async () => {
    await seedClosedProject(repo, "legacy", "Legacy Closed");
    actor = { userSub: "sub-alice", handle: "alice" };
    await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha" }),
    });

    // Admin actor — no membership in either, but allowedProjects="all"
    actor = {
      userSub: "sub-root",
      handle: "root",
      isAdmin: true,
      allowedProjects: "all",
    };
    const r1 = await app.request("/v1/projects/legacy/status");
    expect(r1.status).toBe(200);
    const r2 = await app.request("/v1/projects/alpha/status");
    expect(r2.status).toBe(200);

    // MCP mirror — admin reaches both
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "root", email: null, userSub: "sub-root" },
      allowedProjects: "all",
      isAdmin: true,
    });
    const reply = await callTool(server, "set_active_project", { slug: "legacy" });
    expect(reply.isError).toBeFalsy();
    await server.close();
  });

  // CASE 8 — idempotent join
  it("case 8: second POST /:slug/join → 200 + alreadyMember:true; exactly one membership row", async () => {
    // Alice creates
    actor = { userSub: "sub-alice", handle: "alice" };
    const createRes = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha" }),
    });
    const created = (await createRes.json()) as { id: string };

    // Bob joins
    actor = { userSub: "sub-bob", handle: "bob" };
    const first = await app.request("/v1/projects/alpha/join", { method: "POST" });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { alreadyMember: boolean; role: string };
    expect(firstBody.alreadyMember).toBe(false);
    expect(firstBody.role).toBe("member");

    // Bob joins again
    const second = await app.request("/v1/projects/alpha/join", { method: "POST" });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { alreadyMember: boolean; role: string; slug: string };
    expect(secondBody.alreadyMember).toBe(true);
    expect(secondBody.role).toBe("member");
    expect(secondBody.slug).toBe("alpha");

    // Exactly one membership row for (project, bob) — primary key on (projectId, userSub)
    // guarantees uniqueness; verify via the listing helper.
    const members = await repo.findProjectMembersByUserSub("sub-bob");
    const forAlpha = members.filter((m) => m.projectId === created.id);
    expect(forAlpha).toHaveLength(1);
  });

  // Supplementary: closed-project join is forbidden (T4-documented 403 path)
  it("case 4b: join against a closed project → 403 FORBIDDEN", async () => {
    await seedClosedProject(repo, "legacy", "Legacy");
    actor = { userSub: "sub-bob", handle: "bob" };
    const res = await app.request("/v1/projects/legacy/join", { method: "POST" });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("project 'legacy' is not open to join");
  });

  // Supplementary: missing project on join → 404 from loadProjectAndActor
  it("case 4c: join against unknown slug → 404 NOT_FOUND", async () => {
    actor = { userSub: "sub-bob", handle: "bob" };
    const res = await app.request("/v1/projects/ghost/join", { method: "POST" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  // Supplementary: project.joined audit event is emitted on fresh join
  it("case 4d: fresh join emits a project.joined event with the joiner's userSub", async () => {
    actor = { userSub: "sub-alice", handle: "alice" };
    const createRes = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha", name: "Alpha" }),
    });
    const created = (await createRes.json()) as { id: string };

    actor = { userSub: "sub-bob", handle: "bob" };
    const joinRes = await app.request("/v1/projects/alpha/join", { method: "POST" });
    expect(joinRes.status).toBe(201);

    const events = await repo.findRecentEvents(created.id, 50);
    const joined = events.filter((e) => e.kind === "project.joined");
    expect(joined).toHaveLength(1);
    expect(joined[0]!.userSub).toBe("sub-bob");
    expect(joined[0]!.refId).toBe(created.id);
  });

  // Supplementary: 409 on duplicate slug — preserved by T4
  it("POST /v1/projects with duplicate slug → 409 CONFLICT", async () => {
    actor = { userSub: "sub-alice", handle: "alice" };
    const first = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha" }),
    });
    expect(first.status).toBe(201);
    const dup = await app.request("/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "alpha" }),
    });
    expect(dup.status).toBe(409);
    const body = (await dup.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });
});
