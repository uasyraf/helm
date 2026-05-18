import type { HelmRepo } from "../db/repo.js";
import { newId, now } from "../util/ids.js";
import { emitEvent } from "../events/emit.js";
import type { ScanResult } from "./scanner.js";

export interface IngestContext {
  repo: HelmRepo;
  projectId: string;
  developerId: string | null;
  sprintId: string | null;
}

export interface IngestSummary {
  inserted: number;
  skipped: number;
  filePath: string | null;
}

export async function ingestScan(scan: ScanResult, ctx: IngestContext): Promise<IngestSummary> {
  let inserted = 0;
  let skipped = 0;

  for (const marker of scan.markers) {
    const location = scan.filePath ? `${scan.filePath}:${marker.line}` : `marker:${marker.line}`;
    if (await debtExists(ctx, location)) {
      skipped++;
      continue;
    }
    await insertDebt(ctx, {
      title: trimTitle(marker.description) || `DEBT marker at ${location}`,
      description: marker.raw,
      severity: marker.severity ?? "med",
      location,
      expiresAt: marker.expires ?? null,
    });
    inserted++;
  }

  if (scan.largeFile) {
    const location = scan.largeFile.filePath;
    if (!(await debtExists(ctx, location))) {
      await insertDebt(ctx, {
        title: `Large file (${scan.largeFile.lineCount} lines)`,
        description: `${scan.largeFile.filePath} crossed the 500-line threshold (${scan.largeFile.lineCount} lines). Consider splitting.`,
        severity: "med",
        location,
        expiresAt: null,
      });
      inserted++;
    } else {
      skipped++;
    }
  }

  for (const signal of scan.anyTypes) {
    const location = scan.filePath ? `${scan.filePath}:${signal.line}` : `any:${signal.line}`;
    if (await debtExists(ctx, location)) {
      skipped++;
      continue;
    }
    await insertDebt(ctx, {
      title: `TypeScript : any introduced`,
      description: signal.text,
      severity: "low",
      location,
      expiresAt: null,
    });
    inserted++;
  }

  return { inserted, skipped, filePath: scan.filePath };
}

async function debtExists(ctx: IngestContext, location: string): Promise<boolean> {
  const existing = await ctx.repo.findOpenDebtAtLocation(ctx.projectId, location);
  return existing !== null;
}

interface InsertArgs {
  title: string;
  description: string;
  severity: "low" | "med" | "high" | "critical";
  location: string;
  expiresAt: string | null;
}

async function insertDebt(ctx: IngestContext, args: InsertArgs): Promise<void> {
  const id = newId();
  await ctx.repo.insertDebt({
    id,
    projectId: ctx.projectId,
    title: args.title,
    description: args.description,
    severity: args.severity,
    location: args.location,
    ownerId: ctx.developerId,
    expiresAt: args.expiresAt,
    openedAt: now(),
    closedAt: null,
    linkedStoryId: null,
  });
  await emitEvent(ctx.repo, {
    projectId: ctx.projectId,
    developerId: ctx.developerId,
    sprintId: ctx.sprintId,
    kind: "debt.opened",
    refId: id,
    summary: `auto: ${args.title}${args.location ? ` @ ${args.location}` : ""}`,
  });
}

function trimTitle(input: string): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
}
