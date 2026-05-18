import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { parseDebtMarkers } from "../src/worker/markers/debt.js";
import { detectAnyType, isTypeScriptFile } from "../src/worker/markers/any-type.js";
import { detectLargeFile } from "../src/worker/markers/file-size.js";
import { scanPayload } from "../src/worker/scanner.js";
import { ingestScan } from "../src/worker/ingest.js";
import { openDb, type DbHandle } from "../src/db/client.js";
import { bootstrapSession, type SessionContext } from "../src/project/bootstrap.js";
import { techDebt, progressEvent } from "../src/db/schema.js";
import { eq, and } from "drizzle-orm";

describe("debt marker parser", () => {
  it("parses // DEBT(...) lines with multiple fields", () => {
    const input = `function pay() {\n  // DEBT(owner=alice, expires=2026-Q3, severity=high, ref=DBT-12): retry path missing\n  return null;\n}`;
    const markers = parseDebtMarkers(input);
    expect(markers).toHaveLength(1);
    const m = markers[0]!;
    expect(m.owner).toBe("alice");
    expect(m.expires).toBe("2026-Q3");
    expect(m.severity).toBe("high");
    expect(m.ref).toBe("DBT-12");
    expect(m.line).toBe(2);
    expect(m.description).toContain("retry path missing");
  });

  it("supports # and -- comment prefixes", () => {
    const input = `# DEBT(owner=bob, expires=2026-12-01)\n-- DEBT(owner=carol, severity=low)\n// DEBT(owner=dan)`;
    const markers = parseDebtMarkers(input);
    expect(markers).toHaveLength(3);
    expect(markers[0]?.owner).toBe("bob");
    expect(markers[1]?.owner).toBe("carol");
    expect(markers[1]?.severity).toBe("low");
    expect(markers[2]?.owner).toBe("dan");
  });

  it("ignores unknown keys and bad severities", () => {
    const input = `// DEBT(owner=alice, severity=spicy, bogus=x): hello`;
    const m = parseDebtMarkers(input)[0]!;
    expect(m.owner).toBe("alice");
    expect(m.severity).toBeUndefined();
  });

  it("does not match FIXME or TODO", () => {
    const input = `// FIXME(owner=alice): no\n// TODO: nope`;
    expect(parseDebtMarkers(input)).toHaveLength(0);
  });
});

describe("any-type detector", () => {
  it("flags `: any` and `as any`", () => {
    const input = `const x: any = 1;\nconst y = foo as any;\nconst z: anyway = 2;`;
    const signals = detectAnyType(input);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.text).toContain(": any");
    expect(signals[1]?.text).toContain("as any");
  });

  it("identifies TS files", () => {
    expect(isTypeScriptFile("/x/foo.ts")).toBe(true);
    expect(isTypeScriptFile("/x/foo.tsx")).toBe(true);
    expect(isTypeScriptFile("/x/foo.js")).toBe(false);
    expect(isTypeScriptFile("/x/foo.py")).toBe(false);
  });
});

describe("file-size detector", () => {
  it("flags files over the 500-line threshold", () => {
    const tmp = mkdtempSync(join(tmpdir(), "helm-large-"));
    try {
      const filePath = join(tmp, "big.ts");
      writeFileSync(filePath, Array(600).fill("// line").join("\n"));
      const signal = detectLargeFile(filePath);
      expect(signal).not.toBeNull();
      expect(signal?.lineCount).toBe(600);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns null for small files", () => {
    const tmp = mkdtempSync(join(tmpdir(), "helm-small-"));
    try {
      const filePath = join(tmp, "small.ts");
      writeFileSync(filePath, "one\ntwo\n");
      expect(detectLargeFile(filePath)).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("scan + ingest round-trip", () => {
  let cwd: string;
  let dbPath: string;
  let handle: DbHandle;
  let session: SessionContext;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "helm-worker-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "wkr@helm.local"], { cwd });
    execFileSync("git", ["config", "user.name", "Worker Test"], { cwd });
    dbPath = join(cwd, "test.db");
    handle = await openDb(dbPath);
    session = await bootstrapSession(handle.db, cwd);
  });

  it("Write payload with DEBT marker creates a debt row + progress event", async () => {
    const filePath = join(cwd, "x.ts");
    const content = `export function foo() {\n  // DEBT(owner=alice, severity=high): refactor\n  return 1;\n}`;
    writeFileSync(filePath, content);
    const scan = scanPayload({ tool_name: "Write", tool_input: { file_path: filePath, content } });
    expect(scan.markers).toHaveLength(1);

    const summary = await ingestScan(scan, {
      db: handle.db,
      projectId: session.project.id,
      developerId: session.developer.id,
      sprintId: session.activeSprint.id,
    });
    expect(summary.inserted).toBe(1);

    const rows = await handle.db.select().from(techDebt).where(eq(techDebt.projectId, session.project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.severity).toBe("high");
    expect(rows[0]?.location).toContain("x.ts:2");

    const events = await handle.db
      .select()
      .from(progressEvent)
      .where(and(eq(progressEvent.projectId, session.project.id), eq(progressEvent.kind, "debt.opened")));
    expect(events).toHaveLength(1);
  });

  it("re-running on same file does not duplicate debt rows", async () => {
    const filePath = join(cwd, "x.ts");
    const content = `// DEBT(owner=alice): once`;
    writeFileSync(filePath, content);
    const scan = scanPayload({ tool_name: "Write", tool_input: { file_path: filePath, content } });

    const ctx = {
      db: handle.db,
      projectId: session.project.id,
      developerId: session.developer.id,
      sprintId: session.activeSprint.id,
    };
    const first = await ingestScan(scan, ctx);
    const second = await ingestScan(scan, ctx);
    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("Edit payload scans new_string", async () => {
    const filePath = join(cwd, "y.ts");
    writeFileSync(filePath, "old content");
    const scan = scanPayload({
      tool_name: "Edit",
      tool_input: {
        file_path: filePath,
        old_string: "old content",
        new_string: "// DEBT(owner=carol, severity=critical): broken\nfixed = true",
      },
    });
    expect(scan.markers).toHaveLength(1);
    expect(scan.markers[0]?.severity).toBe("critical");
  });

  it("any-type signal opens debt for TS files", async () => {
    const filePath = join(cwd, "z.ts");
    const content = "const x: any = 1;\n";
    writeFileSync(filePath, content);
    const scan = scanPayload({ tool_name: "Write", tool_input: { file_path: filePath, content } });
    expect(scan.anyTypes).toHaveLength(1);

    const summary = await ingestScan(scan, {
      db: handle.db,
      projectId: session.project.id,
      developerId: session.developer.id,
      sprintId: session.activeSprint.id,
    });
    expect(summary.inserted).toBe(1);
  });
});
