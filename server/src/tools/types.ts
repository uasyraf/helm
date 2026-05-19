import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HelmRepo } from "../db/repo.js";
import type { SessionContext, SessionIdentity } from "../project/bootstrap.js";

export interface ToolContext {
  repo: HelmRepo;
  session: SessionContext;
  cwd: string;
  identity?: SessionIdentity;
  allowedProjects?: ReadonlySet<string> | "all";
  isAdmin?: boolean;
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

export function pendingResult() {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: {
            code: "NO_ACTIVE_PROJECT",
            message: "no active project — call set_active_project with a slug from your accessible projects",
          },
        }),
      },
    ],
  };
}
