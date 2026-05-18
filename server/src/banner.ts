import { openProjectRepo } from "./db/open-repo.js";
import { bootstrapSession, type SessionContext } from "./project/bootstrap.js";
import type { HelmRepo } from "./db/repo.js";

export async function renderBanner(cwd: string = process.cwd()): Promise<string> {
  const { handle } = await openProjectRepo(cwd);
  try {
    const session = await bootstrapSession(handle.repo, cwd);
    return await formatBanner(handle.repo, session);
  } finally {
    await handle.close();
  }
}

async function formatBanner(repo: HelmRepo, session: SessionContext): Promise<string> {
  const sprintRow = session.activeSprint;
  const lengthDays = session.project.sprintLengthDays;
  const day = sprintDayNumber(sprintRow.startedAt);

  const byStatus = await repo.countStoriesInSprintByStatus(sprintRow.id);
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const done = byStatus.done ?? 0;
  const debt = await repo.countOpenDebtByProject(session.project.id);
  const opened = await repo.countEventsByKindInSprint(sprintRow.id, "debt.opened");
  const closed = await repo.countEventsByKindInSprint(sprintRow.id, "debt.closed");
  const delta = opened - closed;
  const sign = delta > 0 ? `+${delta}` : `${delta}`;

  return `[helm] ${sprintRow.name} (d${day}/${lengthDays}) | stories: ${done}/${total} done | debt: ${debt} (Δ${sign})`;
}

function sprintDayNumber(startedAt: string): number {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return 1;
  const diffMs = Date.now() - start;
  return Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
}
