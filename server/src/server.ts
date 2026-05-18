import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bootstrapSession } from "./project/bootstrap.js";
import { openProjectDb } from "./db/open-project.js";
import { registerAllTools } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";

export interface ServerHandle {
  server: McpServer;
  ctx: ToolContext;
  close: () => Promise<void>;
}

export async function buildServer(cwd: string = process.cwd()): Promise<ServerHandle> {
  const { handle } = await openProjectDb(cwd);
  const session = await bootstrapSession(handle.db, cwd);

  const server = new McpServer({
    name: "helm",
    version: "0.1.0",
  });

  const ctx: ToolContext = { db: handle.db, session, cwd };
  registerAllTools(server, ctx);

  return {
    server,
    ctx,
    close: async () => {
      handle.client.close();
    },
  };
}
