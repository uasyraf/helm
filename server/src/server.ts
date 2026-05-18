import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { openDb } from "./db/client.js";
import { bootstrapSession } from "./project/bootstrap.js";
import { detectProject } from "./project/detect.js";
import { dbPathFor } from "./util/paths.js";
import { registerAllTools } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";

export interface ServerHandle {
  server: McpServer;
  ctx: ToolContext;
  close: () => Promise<void>;
}

export async function buildServer(cwd: string = process.cwd()): Promise<ServerHandle> {
  const detected = detectProject(cwd);
  const path = dbPathFor(detected.slug);
  const { db, client } = await openDb(path);
  const session = await bootstrapSession(db, cwd);

  const server = new McpServer({
    name: "helm",
    version: "0.1.0",
  });

  const ctx: ToolContext = { db, session, cwd };
  registerAllTools(server, ctx);

  return {
    server,
    ctx,
    close: async () => {
      client.close();
    },
  };
}
