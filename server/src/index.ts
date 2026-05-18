#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const handle = await buildServer();
  const transport = new StdioServerTransport();
  await handle.server.connect(transport);
}

main().catch((err) => {
  console.error("[helm] fatal:", err);
  process.exit(1);
});
