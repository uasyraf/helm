import { sendScan } from "./client.js";
import type { HookPayload } from "./scanner.js";

interface ClaudeHookInput {
  cwd?: string;
  tool_name?: string;
  tool_input?: HookPayload["tool_input"];
}

const SCAN_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

export async function runPostToolUseHook(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) return;

  let input: ClaudeHookInput;
  try {
    input = JSON.parse(raw) as ClaudeHookInput;
  } catch {
    return;
  }

  const toolName = input.tool_name;
  if (!toolName || !SCAN_TOOLS.has(toolName)) return;
  const filePath = input.tool_input?.file_path;
  if (!filePath) return;

  const payload: HookPayload = { tool_name: toolName, tool_input: input.tool_input ?? {} };
  const cwd = input.cwd ?? process.cwd();

  await sendScan(cwd, payload);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 1000);
  });
}
