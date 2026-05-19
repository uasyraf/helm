#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "../server/src/server.js";
import { renderBanner } from "../server/src/banner.js";
import { installHooks, installSkills } from "../server/src/install.js";
import { runWorker } from "../server/src/worker/server.js";
import { runPostToolUseHook } from "../server/src/worker/hook.js";
import { runDashboard } from "../server/src/dashboard.js";
import { startHttpServer } from "../server/src/http/server.js";
import { runInit } from "../server/src/init.js";
import { runMigrate } from "../server/src/migrate.js";
import { runExport, runImport } from "../server/src/admin/cli.js";

type Command =
  | "serve"
  | "banner"
  | "install-hooks"
  | "install-skills"
  | "worker"
  | "hook"
  | "dashboard"
  | "init"
  | "migrate"
  | "export"
  | "import"
  | "help";

function parseCommand(argv: readonly string[]): Command {
  const cmd = argv[0];
  if (!cmd) return "serve";
  switch (cmd) {
    case "serve":
    case "banner":
    case "install-hooks":
    case "install-skills":
    case "worker":
    case "hook":
    case "dashboard":
    case "init":
    case "migrate":
    case "export":
    case "import":
      return cmd;
    case "-h":
    case "--help":
    case "help":
      return "help";
    default:
      return "help";
  }
}

function flagValue(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a?.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

function flagPresent(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function runServe(): Promise<void> {
  if (flagPresent("http")) {
    const portStr = flagValue("port");
    const host = flagValue("host");
    const handle = await startHttpServer({
      port: portStr ? Number(portStr) : undefined,
      host,
    });
    await new Promise<void>((resolve) => {
      const shutdown = async (): Promise<void> => {
        await handle.close();
        resolve();
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
    return;
  }
  const handle = await buildServer();
  const transport = new StdioServerTransport();
  await handle.server.connect(transport);
}

async function runInitCmd(): Promise<void> {
  const team = flagPresent("team");
  const syncUrl = flagValue("sync-url");
  const syncToken = flagValue("sync-token");
  const nonInteractive = flagPresent("non-interactive") || (syncUrl !== undefined);
  const result = await runInit({ team, syncUrl, syncToken, nonInteractive });
  if (result.wrote) {
    process.stdout.write(`[helm] wrote ${result.configPath}\n`);
  } else if (!team) {
    process.stdout.write("[helm] init currently only supports --team (sync config writer)\n");
  }
}

async function runMigrateCmd(): Promise<void> {
  const result = await runMigrate();
  process.stdout.write(`[helm] unified DB: ${result.unifiedPath}\n`);
  for (const m of result.merged) {
    process.stdout.write(`[helm] merged ${m.source} (slug=${m.slug}, rows=${m.rowsCopied}) → renamed to ${m.source}.bak\n`);
  }
  for (const s of result.skipped) {
    process.stdout.write(`[helm] skipped ${s.source}: ${s.reason}\n`);
  }
  if (result.merged.length === 0 && result.skipped.length === 0) {
    process.stdout.write("[helm] no legacy per-slug DBs found — nothing to migrate\n");
  }
}

async function runBanner(): Promise<void> {
  try {
    const line = await renderBanner();
    process.stdout.write(line + "\n");
  } catch (err) {
    process.stderr.write(`[helm] banner failed: ${(err as Error).message}\n`);
    process.exit(0);
  }
}

function runInstallHooks(): void {
  const result = installHooks();
  if (result.installed.length > 0) {
    process.stdout.write(`[helm] installed hooks (${result.installed.join(", ")}) at ${result.path}\n`);
  } else {
    process.stdout.write(`[helm] hooks already present at ${result.path}\n`);
  }
}

function runInstallSkills(): void {
  const result = installSkills();
  if (result.installed.length > 0) {
    process.stdout.write(`[helm] linked skills: ${result.installed.join(", ")}\n`);
  }
  if (result.skipped.length > 0) {
    process.stdout.write(`[helm] skipped: ${result.skipped.join(", ")}\n`);
  }
}

function runHelp(): void {
  process.stdout.write(
    [
      "helm — durable, multi-developer project state for Claude Code",
      "",
      "usage:",
      "  helm                          start MCP server on stdio (default)",
      "  helm serve                    same as above",
      "  helm serve --http [--port N]  serve MCP over HTTP for team mode (auth via HELM_API_TOKEN)",
      "  helm banner                   print one-line SessionStart banner",
      "  helm worker                   run the PostToolUse scanner daemon (foreground)",
      "  helm hook post-tool-use       hook entry: reads stdin, forwards to worker",
      "  helm dashboard [--dev]        launch the SvelteKit dashboard (built mode or vite dev)",
      "  helm init --team              write .helm/config.json with shared Turso sync URL",
      "  helm migrate                  merge legacy ~/.helm/<slug>.db files into the unified ~/.helm/helm.db",
      "  helm export [--out file]      dump every project's state to a versioned JSON",
      "                                  [--remote URL --token T] hit a remote helm-server admin endpoint",
      "  helm import --in file         restore from an export (locally, or via --remote URL --token T)",
      "  helm install-hooks            wire SessionStart + PostToolUse into ~/.claude/settings.json",
      "  helm install-skills           symlink bundled skills/* (project-tracker + 7 slash commands) into ~/.claude/skills/",
      "  helm help                     show this message",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  switch (command) {
    case "serve":
      await runServe();
      return;
    case "banner":
      await runBanner();
      return;
    case "worker":
      await runWorker();
      return;
    case "hook":
      await runPostToolUseHook();
      return;
    case "dashboard": {
      const dev = process.argv.includes("--dev");
      const code = await runDashboard({ dev });
      process.exit(code);
    }
    case "init":
      await runInitCmd();
      return;
    case "migrate":
      await runMigrateCmd();
      return;
    case "export":
      await runExport({
        out: flagValue("out"),
        remoteUrl: flagValue("remote") ?? process.env.HELM_URL,
        token: flagValue("token") ?? process.env.HELM_TOKEN,
      });
      return;
    case "import":
      await runImport({
        in: flagValue("in"),
        remoteUrl: flagValue("remote") ?? process.env.HELM_URL,
        token: flagValue("token") ?? process.env.HELM_TOKEN,
      });
      return;
    case "install-hooks":
      runInstallHooks();
      return;
    case "install-skills":
      runInstallSkills();
      return;
    case "help":
      runHelp();
      return;
  }
}

main().catch((err) => {
  process.stderr.write(`[helm] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
