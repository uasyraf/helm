import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bootstrapSession, type SessionContext, type SessionIdentity } from "./project/bootstrap.js";
import { openProjectRepo } from "./db/open-repo.js";
import { registerAllTools } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";
import type { HelmRepo, RepoHandle } from "./db/repo.js";

export interface ServerHandle {
  server: McpServer;
  ctx: ToolContext;
  close: () => Promise<void>;
}

export interface BuildServerOptions {
  cwd?: string;
  repo?: HelmRepo;
  session?: SessionContext;
  closeRepo?: boolean;
  identity?: SessionIdentity;
  allowedProjects?: ReadonlySet<string> | "all";
  isAdmin?: boolean;
}

export async function buildServer(arg?: string | BuildServerOptions): Promise<ServerHandle> {
  const opts: BuildServerOptions = typeof arg === "string" ? { cwd: arg } : (arg ?? {});
  const cwd = opts.cwd ?? process.cwd();

  let repo: HelmRepo;
  let session: SessionContext;
  let cleanup: () => Promise<void>;

  if (opts.repo && opts.session) {
    repo = opts.repo;
    session = opts.session;
    cleanup = async () => {};
  } else if (opts.repo) {
    repo = opts.repo;
    session = await bootstrapSession(repo, cwd);
    cleanup = async () => {};
  } else {
    const opened = await openProjectRepo(cwd);
    repo = opened.handle.repo;
    session = await bootstrapSession(repo, cwd);
    cleanup = async () => {
      await opened.handle.close();
    };
  }

  const server = new McpServer({
    name: "helm",
    version: "0.1.0",
  });

  const ctx: ToolContext = {
    repo,
    session,
    cwd,
    identity: opts.identity,
    allowedProjects: opts.allowedProjects,
    isAdmin: opts.isAdmin,
  };
  registerAllTools(server, ctx);

  return {
    server,
    ctx,
    close: cleanup,
  };
}

export async function openSharedRepo(cwd: string): Promise<RepoHandle> {
  const opened = await openProjectRepo(cwd);
  return opened.handle;
}
