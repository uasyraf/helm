import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./types.js";
import { registerStatusTools } from "./status.js";
import { registerSprintTools } from "./sprint.js";
import { registerEpicTools } from "./epic.js";
import { registerStoryTools } from "./story.js";
import { registerTaskTools } from "./task.js";
import { registerDebtTools } from "./debt.js";
import { registerDecisionTools } from "./decision.js";
import { registerProgressTools } from "./progress.js";
import { registerNelsonTools } from "./nelson.js";

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerStatusTools(server, ctx);
  registerSprintTools(server, ctx);
  registerEpicTools(server, ctx);
  registerStoryTools(server, ctx);
  registerTaskTools(server, ctx);
  registerDebtTools(server, ctx);
  registerDecisionTools(server, ctx);
  registerProgressTools(server, ctx);
  registerNelsonTools(server, ctx);
}
