import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { loadConfig } from "../src/config/load.js";
import { runInit } from "../src/init.js";
import { startHttpServer } from "../src/http/server.js";

describe("loadConfig", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "helm-cfg-"));
    delete process.env.HELM_SYNC_URL;
    delete process.env.HELM_SYNC_TOKEN;
    delete process.env.HELM_SYNC_INTERVAL_MS;
    delete process.env.HELM_API_TOKEN;
    delete process.env.HELM_SERVER_URL;
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("returns null sync when no env and no file", () => {
    const cfg = loadConfig(cwd);
    expect(cfg.sync).toBeNull();
  });

  it("reads sync from .helm/config.json", () => {
    mkdirSync(join(cwd, ".helm"));
    writeFileSync(join(cwd, ".helm", "config.json"), JSON.stringify({ sync: { url: "libsql://example", authToken: "t1" } }));
    const cfg = loadConfig(cwd);
    expect(cfg.sync?.url).toBe("libsql://example");
    expect(cfg.sync?.authToken).toBe("t1");
    expect(cfg.sync?.syncIntervalMs).toBe(5000);
  });

  it("env vars override file values", () => {
    mkdirSync(join(cwd, ".helm"));
    writeFileSync(join(cwd, ".helm", "config.json"), JSON.stringify({ sync: { url: "libsql://file" } }));
    process.env.HELM_SYNC_URL = "libsql://env";
    process.env.HELM_SYNC_TOKEN = "env-tok";
    const cfg = loadConfig(cwd);
    expect(cfg.sync?.url).toBe("libsql://env");
    expect(cfg.sync?.authToken).toBe("env-tok");
  });

  it("walks up to find ancestor .helm/config.json", () => {
    mkdirSync(join(cwd, "sub", "deeper"), { recursive: true });
    mkdirSync(join(cwd, ".helm"));
    writeFileSync(join(cwd, ".helm", "config.json"), JSON.stringify({ sync: { url: "libsql://anc" } }));
    const cfg = loadConfig(join(cwd, "sub", "deeper"));
    expect(cfg.sync?.url).toBe("libsql://anc");
  });
});

describe("runInit --team", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "helm-init-"));
    execFileSync("git", ["init", "-q"], { cwd });
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("writes .helm/config.json non-interactively", async () => {
    const result = await runInit({
      team: true,
      syncUrl: "libsql://t",
      syncToken: "t1",
      nonInteractive: true,
      cwd,
    });
    expect(result.wrote).toBe(true);
    const written = JSON.parse(readFileSync(result.configPath, "utf8"));
    expect(written.sync.url).toBe("libsql://t");
    expect(written.sync.authToken).toBe("t1");
  });

  it("preserves existing keys when rewriting", async () => {
    mkdirSync(join(cwd, ".helm"));
    writeFileSync(join(cwd, ".helm", "config.json"), JSON.stringify({ server: { url: "https://x" } }));
    await runInit({ team: true, syncUrl: "libsql://t", nonInteractive: true, cwd });
    const written = JSON.parse(readFileSync(join(cwd, ".helm", "config.json"), "utf8"));
    expect(written.server.url).toBe("https://x");
    expect(written.sync.url).toBe("libsql://t");
  });
});

describe("HTTP server", () => {
  let cwd: string;
  let homeSandbox: string;
  let prevHelmHome: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "helm-http-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "http@helm.local"], { cwd });
    execFileSync("git", ["config", "user.name", "HTTP Test"], { cwd });
    homeSandbox = mkdtempSync(join(tmpdir(), "helm-home-"));
    prevHelmHome = process.env.HELM_HOME;
    process.env.HELM_HOME = homeSandbox;
  });
  afterEach(() => {
    if (prevHelmHome === undefined) delete process.env.HELM_HOME;
    else process.env.HELM_HOME = prevHelmHome;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(homeSandbox, { recursive: true, force: true });
  });

  it("/health returns 200 ok", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, cwd });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.name).toBe("helm");
    } finally {
      await handle.close();
    }
  });

  it("/mcp without bearer returns 401 when token set", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, apiToken: "secret", cwd });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(res.status).toBe(401);
    } finally {
      await handle.close();
    }
  });

  it("/mcp with valid bearer responds to initialize", async () => {
    const handle = await startHttpServer({ host: "127.0.0.1", port: 0, apiToken: "secret", cwd });
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer secret",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("mcp-session-id")).toBeTruthy();
    } finally {
      await handle.close();
    }
  });
});
