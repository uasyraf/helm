import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { progressEvent } from "../db/schema.js";
import { newId, now } from "../util/ids.js";

export type EventKind =
  | "sprint.started"
  | "sprint.ended"
  | "epic.opened"
  | "epic.updated"
  | "epic.closed"
  | "story.opened"
  | "story.updated"
  | "story.moved"
  | "story.closed"
  | "task.opened"
  | "task.updated"
  | "task.closed"
  | "debt.opened"
  | "debt.closed"
  | "decision.recorded"
  | "mission.linked"
  | "mission.logged"
  | "progress.logged";

export interface EmitArgs {
  projectId: string;
  developerId: string | null;
  sprintId?: string | null;
  kind: EventKind;
  refId?: string | null;
  summary: string;
}

export async function emitEvent(db: Db, args: EmitArgs): Promise<void> {
  await db.insert(progressEvent).values({
    id: newId(),
    projectId: args.projectId,
    developerId: args.developerId,
    sprintId: args.sprintId ?? null,
    kind: args.kind,
    refId: args.refId ?? null,
    summary: args.summary,
    ts: now(),
  });
}

export async function recentEvents(db: Db, projectId: string, limit = 50) {
  return db
    .select()
    .from(progressEvent)
    .where(eq(progressEvent.projectId, projectId))
    .orderBy(progressEvent.ts)
    .limit(limit);
}
