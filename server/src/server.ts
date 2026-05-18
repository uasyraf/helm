import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bootstrapSession } from "./project/bootstrap.js";
import { openProjectRepo } from "./db/open-repo.js";
import { registerAllTools } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";

export interface ServerHandle {
  server: McpServer;
  ctx: ToolContext;
  close: () => Promise<void>;
}

export async function buildServer(cwd: string = process.cwd()): Promise<ServerHandle> {
  const { handle } = await openProjectRepo(cwd);
  const session = await bootstrapSession(handle.repo, cwd);

  const server = new McpServer({
    name: "helm",
    version: "0.1.0",
  });

  const ctx: ToolContext = { repo: handle.repo, session, cwd };
  registerAllTools(server, ctx);

  return {
    server,
    ctx,
    close: async () => {
      await handle.close();
    },
  };
}
