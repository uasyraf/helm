import type { HelmRepo } from "../db/repo.js";
import type {
  Project,
  Developer,
  Sprint,
  Epic,
  Story,
  Task,
  TechDebt,
  Decision,
  ProgressEvent,
} from "../db/schema.js";

export const EXPORT_FORMAT_VERSION = 1;

export interface HelmDump {
  format: typeof EXPORT_FORMAT_VERSION;
  schemaVersion: string;
  exportedAt: string;
  projects: ProjectDump[];
}

export interface ProjectDump {
  project: Project;
  developers: Developer[];
  sprints: Sprint[];
  epics: Epic[];
  stories: Story[];
  tasks: Task[];
  debt: TechDebt[];
  decisions: Decision[];
  events: ProgressEvent[];
}

export async function exportAll(repo: HelmRepo, schemaVersion: string): Promise<HelmDump> {
  const projects = await repo.findAllProjects();
  const dump: HelmDump = {
    format: EXPORT_FORMAT_VERSION,
    schemaVersion,
    exportedAt: new Date().toISOString(),
    projects: [],
  };
  for (const p of projects) {
    dump.projects.push(await dumpProject(repo, p));
  }
  return dump;
}

async function dumpProject(repo: HelmRepo, project: Project): Promise<ProjectDump> {
  const developers = await repo.findDevelopersByProject(project.id);
  const sprints = await repo.findSprintsByProject(project.id);
  const epics = await repo.findEpicsByProject(project.id);
  const debt = await repo.findAllDebtByProject(project.id, 100_000);
  const decisions = await repo.findDecisionsByProject(project.id, 100_000);
  const events = await repo.findRecentEvents(project.id, 100_000);

  const stories: Story[] = [];
  const seenStoryIds = new Set<string>();
  const backlog = await repo.findBacklogStories(project.id, 100_000);
  for (const s of backlog) {
    stories.push(s);
    seenStoryIds.add(s.id);
  }
  for (const sprint of sprints) {
    const rows = await repo.findStoriesInSprint(sprint.id);
    for (const s of rows) {
      if (seenStoryIds.has(s.id)) continue;
      stories.push(s);
      seenStoryIds.add(s.id);
    }
  }

  const tasks: Task[] = [];
  if (repo.findTasksByProject) {
    const rows = await repo.findTasksByProject(project.id, 100_000);
    tasks.push(...rows);
  }

  return { project, developers, sprints, epics, stories, tasks, debt, decisions, events };
}

export async function importAll(repo: HelmRepo, dump: HelmDump): Promise<{ projects: number; rows: number }> {
  if (dump.format !== EXPORT_FORMAT_VERSION) {
    throw new Error(`unsupported export format ${dump.format}; expected ${EXPORT_FORMAT_VERSION}`);
  }
  let rows = 0;
  for (const p of dump.projects) {
    await repo.insertProject(p.project);
    for (const d of p.developers) {
      await repo.insertDeveloper(d);
      rows++;
    }
    for (const s of p.sprints) {
      await repo.insertSprint(s);
      rows++;
    }
    for (const e of p.epics) {
      await repo.insertEpic(e);
      rows++;
    }
    for (const s of p.stories) {
      await repo.insertStory(s);
      rows++;
    }
    for (const t of p.tasks) {
      await repo.insertTask(t);
      rows++;
    }
    for (const d of p.debt) {
      await repo.insertDebt(d);
      rows++;
    }
    for (const dec of p.decisions) {
      await repo.insertDecision(dec);
      rows++;
    }
    for (const ev of p.events) {
      await repo.emitEvent(ev);
      rows++;
    }
  }
  return { projects: dump.projects.length, rows };
}
