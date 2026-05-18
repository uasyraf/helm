import type { HelmRepo } from "../db/repo.js";
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

export async function emitEvent(repo: HelmRepo, args: EmitArgs): Promise<void> {
  await repo.emitEvent({
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

export async function recentEvents(repo: HelmRepo, projectId: string, limit = 50) {
  return repo.findRecentEvents(projectId, limit);
}
