import type { Project, Developer, Sprint, Epic, Story, Task, TechDebt, Decision, ProgressEvent } from "./schema.js";

export type EpicUpdate = Partial<Pick<Epic, "title" | "description" | "priority" | "status" | "targetSprintId">>;
export type StoryUpdate = Partial<Pick<Story, "title" | "description" | "acceptance" | "status" | "size" | "assigneeId" | "priority" | "epicId" | "sprintId" | "startedAt" | "completedAt">>;
export type TaskUpdate = Partial<Pick<Task, "title" | "status" | "assigneeId" | "blockedBy">>;
export type SprintUpdate = Partial<Pick<Sprint, "name" | "goal" | "status" | "endedAt" | "wipLimit">>;
export type StatusCounts = Record<string, number>;

export interface HelmRepo {
  // project
  findProjectBySlug(slug: string): Promise<Project | null>;
  insertProject(project: Project): Promise<void>;

  // developer
  findDeveloperByHandle(projectId: string, handle: string): Promise<Developer | null>;
  insertDeveloper(developer: Developer): Promise<void>;
  touchDeveloper(id: string, lastSeenAt: string): Promise<void>;
  findDevelopersByProject(projectId: string): Promise<Developer[]>;

  // sprint
  findActiveSprint(projectId: string): Promise<Sprint | null>;
  findSprintById(id: string): Promise<Sprint | null>;
  findSprintsByProject(projectId: string): Promise<Sprint[]>;
  insertSprint(sprint: Sprint): Promise<void>;
  updateSprint(id: string, updates: SprintUpdate): Promise<void>;
  closeActiveSprints(projectId: string, endedAt: string): Promise<void>;
  countSprintsByProject(projectId: string): Promise<number>;

  // epic
  insertEpic(epic: Epic): Promise<void>;
  updateEpic(id: string, updates: EpicUpdate): Promise<void>;
  findEpicsByProject(projectId: string): Promise<Epic[]>;

  // story
  insertStory(story: Story): Promise<void>;
  updateStory(id: string, updates: StoryUpdate): Promise<void>;
  findStoryById(id: string): Promise<Story | null>;
  findStoriesInSprint(sprintId: string): Promise<Story[]>;
  findStoriesInSprintNotDoneOrDropped(sprintId: string): Promise<Story[]>;
  rolloverIncompleteStoriesToBacklog(sprintId: string): Promise<number>;
  findBacklogStories(projectId: string, limit: number): Promise<Story[]>;
  countStoriesInSprintByStatus(sprintId: string): Promise<StatusCounts>;
  countBacklog(projectId: string): Promise<number>;
  countDoneStoriesInSprint(sprintId: string): Promise<number>;

  // task
  insertTask(task: Task): Promise<void>;
  updateTask(id: string, updates: TaskUpdate): Promise<void>;

  // tech_debt
  insertDebt(debt: TechDebt): Promise<void>;
  closeDebt(id: string, closedAt: string): Promise<void>;
  findOpenDebtByProject(projectId: string, limit: number): Promise<TechDebt[]>;
  findAllDebtByProject(projectId: string, limit: number): Promise<TechDebt[]>;
  findOpenDebtAtLocation(projectId: string, location: string): Promise<TechDebt | null>;
  countOpenDebtByProject(projectId: string): Promise<number>;

  // decision
  insertDecision(decision: Decision): Promise<void>;
  findDecisionsByProject(projectId: string, limit: number): Promise<Decision[]>;

  // progress_event
  emitEvent(event: ProgressEvent): Promise<void>;
  findRecentEvents(projectId: string, limit: number): Promise<ProgressEvent[]>;
  findEventsForSprint(sprintId: string, limit: number): Promise<ProgressEvent[]>;
  countEventsByKindInSprint(sprintId: string, kind: string): Promise<number>;
  findEventsByDeveloper(projectId: string, developerId: string, limit: number): Promise<ProgressEvent[]>;
}

export interface RepoHandle {
  readonly repo: HelmRepo;
  readonly sync: (() => Promise<void>) | null;
  readonly close: () => Promise<void>;
}
