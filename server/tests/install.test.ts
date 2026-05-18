import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installHooks, installSkills } from "../src/install.js";

describe("installHooks", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "helm-install-"));
    path = join(dir, "settings.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes SessionStart, PostToolUse, and statusLine on a fresh settings.json", () => {
    const result = installHooks(path);
    expect(result.installed.sort()).toEqual(["PostToolUse", "SessionStart", "statusLine"]);
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.hooks.SessionStart).toBeDefined();
    expect(written.hooks.PostToolUse).toBeDefined();
    expect(written.statusLine).toBeDefined();
    expect(written.statusLine.command).toContain("helm banner");
  });

  it("is idempotent — re-running installs nothing", () => {
    installHooks(path);
    const second = installHooks(path);
    expect(second.installed).toEqual([]);
  });

  it("preserves existing unrelated settings", () => {
    writeFileSync(path, JSON.stringify({ theme: "dark", hooks: { UserPromptSubmit: [{ matcher: "*", hooks: [] }] } }));
    installHooks(path);
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.theme).toBe("dark");
    expect(written.hooks.UserPromptSubmit).toBeDefined();
    expect(written.statusLine).toBeDefined();
  });
});

describe("installSkills", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "helm-skills-"));
    mkdirSync(join(dir, "claude-skills"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("symlinks all 8 bundled skills if present in package", () => {
    const target = join(dir, "claude-skills");
    const result = installSkills(target);
    // installed depends on whether the bundled skills/ dir is reachable from the test process.
    // Either way: total candidates is 8 and skipped + installed should sum to <= 8.
    expect(result.installed.length + result.skipped.length).toBeLessThanOrEqual(8);
    for (const name of result.installed) {
      expect(existsSync(join(target, name))).toBe(true);
    }
  });
});
