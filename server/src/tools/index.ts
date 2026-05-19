import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "./types.js";
import { pendingResult } from "./types.js";
import { registerStatusTools } from "./status.js";
import { registerSprintTools } from "./sprint.js";
import { registerEpicTools } from "./epic.js";
import { registerStoryTools } from "./story.js";
import { registerTaskTools } from "./task.js";
import { registerDebtTools } from "./debt.js";
import { registerDecisionTools } from "./decision.js";
import { registerProgressTools } from "./progress.js";
import { registerNelsonTools } from "./nelson.js";
import { ALWAYS_AVAILABLE_TOOLS, registerActiveProjectTools } from "./active-project.js";

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  const guarded = wrapForPendingGuard(server, ctx);
  registerActiveProjectTools(server, ctx);
  registerStatusTools(guarded, ctx);
  registerSprintTools(guarded, ctx);
  registerEpicTools(guarded, ctx);
  registerStoryTools(guarded, ctx);
  registerTaskTools(guarded, ctx);
  registerDebtTools(guarded, ctx);
  registerDecisionTools(guarded, ctx);
  registerProgressTools(guarded, ctx);
  registerNelsonTools(guarded, ctx);
}

function wrapForPendingGuard(server: McpServer, ctx: ToolContext): McpServer {
  const proxy = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return function patched(...args: unknown[]) {
          const [name, def, handler] = args as [string, unknown, (input: unknown, extra: unknown) => unknown];
          if (ALWAYS_AVAILABLE_TOOLS.has(name)) {
            return (target as unknown as { registerTool: (...x: unknown[]) => unknown }).registerTool(
              name,
              def,
              handler,
            );
          }
          const wrapped = async (input: unknown, extra: unknown): Promise<unknown> => {
            if (ctx.session.pending) return pendingResult();
            return handler(input, extra);
          };
          return (target as unknown as { registerTool: (...x: unknown[]) => unknown }).registerTool(
            name,
            def,
            wrapped,
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return proxy as McpServer;
}
