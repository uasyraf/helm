import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import { bootstrapSession, pendingSession } from "../src/project/bootstrap.js";
import { buildServer } from "../src/server.js";

function makeGitRepo(remote: string, dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@helm.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
}

interface ToolReply {
  isError?: boolean;
  content: { type: string; text: string }[];
}

async function callTool(server: import("../src/server.js").ServerHandle, name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  const tool = (server.server as unknown as { _registeredTools: Record<string, { handler: (a: Record<string, unknown>, extra: unknown) => Promise<ToolReply> }> })
    ._registeredTools[name];
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.handler(args, {});
}

describe("MCP pending session + set_active_project", () => {
  let home: string;
  let handle: DbHandle;
  let dirA: string;
  let dirB: string;
  let slugA: string;
  let slugB: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "helm-mcp-ap-"));
    process.env.HELM_HOME = home;
    handle = await openDb(join(home, "mcp.db"));
    const repo = makeSqliteRepo(handle.db);
    dirA = mkdtempSync(join(tmpdir(), "helm-mcp-a-"));
    dirB = mkdtempSync(join(tmpdir(), "helm-mcp-b-"));
    makeGitRepo("git@github.com:acme/alpha.git", dirA);
    makeGitRepo("git@github.com:acme/beta.git", dirB);
    const sa = await bootstrapSession(repo, dirA);
    const sb = await bootstrapSession(repo, dirB);
    slugA = sa.project.slug;
    slugB = sb.project.slug;
  });

  afterEach(() => {
    handle.client.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("guarded tool returns NO_ACTIVE_PROJECT before set_active_project", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: "alice@example.com", userSub: "sub-1" },
      allowedProjects: new Set([slugA]),
    });
    const reply = await callTool(server, "get_status");
    expect(reply.isError).toBe(true);
    const parsed = JSON.parse(reply.content[0]!.text) as { error: { code: string } };
    expect(parsed.error.code).toBe("NO_ACTIVE_PROJECT");
    await server.close();
  });

  it("set_active_project on allowed slug unlocks subsequent tools", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: "alice@example.com", userSub: "sub-1" },
      allowedProjects: new Set([slugA]),
    });
    const select = await callTool(server, "set_active_project", { slug: slugA });
    expect(select.isError).toBeFalsy();
    const status = await callTool(server, "get_status");
    expect(status.isError).toBeFalsy();
    const parsed = JSON.parse(status.content[0]!.text) as { project: { slug: string } };
    expect(parsed.project.slug).toBe(slugA);
    await server.close();
  });

  it("set_active_project refuses a slug outside the claim", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: null, userSub: "sub-1" },
      allowedProjects: new Set([slugA]),
    });
    const reply = await callTool(server, "set_active_project", { slug: slugB });
    expect(reply.isError).toBe(true);
    const parsed = JSON.parse(reply.content[0]!.text) as { error: { code: string } };
    expect(parsed.error.code).toBe("FORBIDDEN");
    await server.close();
  });

  it("admin can target any project", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "root", email: null, userSub: "sub-root" },
      allowedProjects: "all",
      isAdmin: true,
    });
    const reply = await callTool(server, "set_active_project", { slug: slugB });
    expect(reply.isError).toBeFalsy();
    await server.close();
  });

  it("list_accessible_projects returns claim-filtered slugs", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: null, userSub: "sub-1" },
      allowedProjects: new Set([slugA]),
    });
    const reply = await callTool(server, "list_accessible_projects");
    const parsed = JSON.parse(reply.content[0]!.text) as { projects: { slug: string }[]; admin: boolean };
    expect(parsed.projects.map((p) => p.slug)).toEqual([slugA]);
    expect(parsed.admin).toBe(false);
    await server.close();
  });

  it("stdio-path session (non-pending) bypasses the guard", async () => {
    const repo = makeSqliteRepo(handle.db);
    const session = await bootstrapSession(repo, dirA);
    const server = await buildServer({ repo, session });
    const status = await callTool(server, "get_status");
    expect(status.isError).toBeFalsy();
    await server.close();
  });

  it("create_project provisions a new project and makes caller the owner", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: "alice@example.com", userSub: "sub-1" },
      allowedProjects: new Set<string>(),
    });
    const reply = await callTool(server, "create_project", {
      slug: "new-thing",
      name: "Some New Thing",
    });
    expect(reply.isError).toBeFalsy();
    const parsed = JSON.parse(reply.content[0]!.text) as {
      project: { slug: string; name: string };
      role: string;
    };
    expect(parsed.project.slug).toBe("new-thing");
    expect(parsed.project.name).toBe("Some New Thing");
    expect(parsed.role).toBe("owner");

    // Verify membership row was created
    const project = await repo.findProjectBySlug("new-thing");
    expect(project).not.toBeNull();
    const member = await repo.findProjectMember(project!.id, "sub-1");
    expect(member?.role).toBe("owner");
    await server.close();
  });

  it("create_project refuses unauthenticated callers", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "anon", email: null, userSub: null },
      allowedProjects: new Set<string>(),
    });
    const reply = await callTool(server, "create_project", { slug: "anon-attempt" });
    expect(reply.isError).toBe(true);
    const parsed = JSON.parse(reply.content[0]!.text) as { error: { code: string } };
    expect(parsed.error.code).toBe("UNAUTHORIZED");
    await server.close();
  });

  it("create_project rejects reserved slugs and invalid formats", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: null, userSub: "sub-1" },
      allowedProjects: new Set<string>(),
    });
    const reserved = await callTool(server, "create_project", { slug: "admin" });
    expect(reserved.isError).toBe(true);
    const upper = await callTool(server, "create_project", { slug: "HasCaps" });
    expect(upper.isError).toBe(true);
    await server.close();
  });

  it("create_project returns CONFLICT on duplicate slug", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: null, userSub: "sub-1" },
      allowedProjects: new Set<string>(),
    });
    const first = await callTool(server, "create_project", { slug: "dup-test" });
    expect(first.isError).toBeFalsy();
    const second = await callTool(server, "create_project", { slug: "dup-test" });
    expect(second.isError).toBe(true);
    const parsed = JSON.parse(second.content[0]!.text) as { error: { code: string } };
    expect(parsed.error.code).toBe("CONFLICT");
    await server.close();
  });

  it("join_project adds caller as member when project is open_join", async () => {
    const repo = makeSqliteRepo(handle.db);
    // Provision as alice
    const aliceServer = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: null, userSub: "sub-alice" },
      allowedProjects: new Set<string>(),
    });
    await callTool(aliceServer, "create_project", { slug: "team-thing" });
    await aliceServer.close();

    // Join as bob
    const bobServer = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "bob", email: null, userSub: "sub-bob" },
      allowedProjects: new Set<string>(),
    });
    const reply = await callTool(bobServer, "join_project", { slug: "team-thing" });
    expect(reply.isError).toBeFalsy();
    const parsed = JSON.parse(reply.content[0]!.text) as {
      slug: string;
      role: string;
      alreadyMember: boolean;
    };
    expect(parsed.slug).toBe("team-thing");
    expect(parsed.role).toBe("member");
    expect(parsed.alreadyMember).toBe(false);

    // Second call is idempotent
    const replay = await callTool(bobServer, "join_project", { slug: "team-thing" });
    expect(replay.isError).toBeFalsy();
    const replayParsed = JSON.parse(replay.content[0]!.text) as { alreadyMember: boolean };
    expect(replayParsed.alreadyMember).toBe(true);
    await bobServer.close();
  });

  it("join_project returns NOT_FOUND for unknown slug", async () => {
    const repo = makeSqliteRepo(handle.db);
    const server = await buildServer({
      repo,
      session: pendingSession(),
      identity: { handle: "alice", email: null, userSub: "sub-1" },
      allowedProjects: new Set<string>(),
    });
    const reply = await callTool(server, "join_project", { slug: "does-not-exist" });
    expect(reply.isError).toBe(true);
    const parsed = JSON.parse(reply.content[0]!.text) as { error: { code: string } };
    expect(parsed.error.code).toBe("NOT_FOUND");
    await server.close();
  });
});
