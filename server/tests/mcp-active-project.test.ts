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
});
