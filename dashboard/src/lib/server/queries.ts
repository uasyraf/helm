import type { HelmRepo } from "$helm/db/repo.js";

export async function loadProject(repo: HelmRepo, slug: string) {
  return repo.findProjectBySlug(slug);
}

export async function loadActiveSprint(repo: HelmRepo, projectId: string) {
  return repo.findActiveSprint(projectId);
}

export async function loadAllSprints(repo: HelmRepo, projectId: string) {
  return repo.findSprintsByProject(projectId);
}

export async function loadSprintById(repo: HelmRepo, sprintId: string) {
  return repo.findSprintById(sprintId);
}

export async function loadStoriesInSprint(repo: HelmRepo, sprintId: string) {
  return repo.findStoriesInSprint(sprintId);
}

export async function loadOpenDebt(repo: HelmRepo, projectId: string, limit = 100) {
  return repo.findOpenDebtByProject(projectId, limit);
}

export async function loadAllDebt(repo: HelmRepo, projectId: string, limit = 500) {
  return repo.findAllDebtByProject(projectId, limit);
}

export async function loadRecentEvents(repo: HelmRepo, projectId: string, limit = 30) {
  return repo.findRecentEvents(projectId, limit);
}

export interface SprintMetric {
  sprintId: string;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  storiesTotal: number;
  storiesDone: number;
  debtOpened: number;
  debtClosed: number;
  debtDelta: number;
}

export async function loadSprintMetrics(repo: HelmRepo, projectId: string): Promise<SprintMetric[]> {
  const sprints = await loadAllSprints(repo, projectId);
  const out: SprintMetric[] = [];
  for (const s of sprints) out.push(await computeSprintMetric(repo, s));
  return out;
}

export async function computeSprintMetric(
  repo: HelmRepo,
  s: { id: string; name: string; status: string; startedAt: string; endedAt: string | null },
): Promise<SprintMetric> {
  const byStatus = await repo.countStoriesInSprintByStatus(s.id);
  const storiesTotal = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const storiesDone = byStatus.done ?? 0;
  const debtOpened = await repo.countEventsByKindInSprint(s.id, "debt.opened");
  const debtClosed = await repo.countEventsByKindInSprint(s.id, "debt.closed");
  return {
    sprintId: s.id,
    name: s.name,
    status: s.status,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    storiesTotal,
    storiesDone,
    debtOpened,
    debtClosed,
    debtDelta: debtOpened - debtClosed,
  };
}

export async function loadEventsForSprint(repo: HelmRepo, sprintId: string, limit = 100) {
  return repo.findEventsForSprint(sprintId, limit);
}

export async function loadEpics(repo: HelmRepo, projectId: string) {
  return repo.findEpicsByProject(projectId);
}

export async function loadDevelopers(repo: HelmRepo, projectId: string) {
  return repo.findDevelopersByProject(projectId);
}

export async function loadDecisions(repo: HelmRepo, projectId: string, limit = 50) {
  return repo.findDecisionsByProject(projectId, limit);
}
