import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Db } from "../db/client.js";
import type { SessionContext } from "../project/bootstrap.js";

export interface ToolContext {
  db: Db;
  session: SessionContext;
  cwd: string;
}

export type ToolRegistrar = (server: McpServer, ctx: ToolContext) => void;

export function jsonResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
