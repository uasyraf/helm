import type { HelmRepo, StatusCounts } from "$helm/db/repo.js";
import type {
  Project,
  ProjectMember,
  Developer,
  Sprint,
  Epic,
  Story,
  TechDebt,
  Decision,
  ProgressEvent,
} from "$helm/db/schema.js";

interface RemoteRepoOpts {
  baseUrl: string;
  token?: string;
}

export interface JoinResult {
  slug: string;
  role: "owner" | "member";
  alreadyMember: boolean;
}

export interface RemoteCapabilities {
  joinProject(slug: string): Promise<JoinResult>;
}

export type RemoteHelmRepo = HelmRepo & RemoteCapabilities;

export class RemoteHttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = "RemoteHttpError";
  }
}

// Cache id → slug since the REST surface is slug-keyed but the HelmRepo
// interface is id-keyed. Populated lazily as the dashboard navigates.
class SlugCache {
  private bySlug = new Map<string, Project>();
  private byId = new Map<string, Project>();
  remember(p: Project): void {
    this.bySlug.set(p.slug, p);
    this.byId.set(p.id, p);
  }
  slugFor(projectId: string): string | null {
    return this.byId.get(projectId)?.slug ?? null;
  }
}

export function makeRemoteHelmRepo(opts: RemoteRepoOpts): RemoteHelmRepo {
  const baseUrl = opts.baseUrl.endsWith("/") ? opts.baseUrl.slice(0, -1) : opts.baseUrl;
  const cache = new SlugCache();

  const headers: HeadersInit = {
    accept: "application/json",
    ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
  };

  const writeHeaders: HeadersInit = {
    ...headers,
    "content-type": "application/json",
  };

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (!res.ok) throw new Error(`helm GET ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  // Surface HTTP status + body on remote write failures so SvelteKit form
  // actions can translate them into user-facing inline errors (401/403/409/...).
  async function postJson<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: { code: "BAD_RESPONSE", message: text.slice(0, 200) } };
      }
    }
    if (!res.ok) {
      const err = parsed as { error?: { code?: string; message?: string } } | null;
      const code = err?.error?.code ?? `HTTP_${res.status}`;
      const message = err?.error?.message ?? `helm POST ${path} → ${res.status}`;
      const e = new RemoteHttpError(message, res.status, code);
      throw e;
    }
    return { status: res.status, body: parsed as T };
  }

  async function getOptional<T>(path: string): Promise<T | null> {
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`helm GET ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  async function resolveSlug(projectId: string): Promise<string> {
    const cached = cache.slugFor(projectId);
    if (cached) return cached;
    const list = await get<{ projects: Project[] }>("/v1/projects");
    for (const p of list.projects) cache.remember(p);
    const slug = cache.slugFor(projectId);
    if (!slug) throw new Error(`unknown project id ${projectId}`);
    return slug;
  }

  const writeUnsupported = (op: string) => {
    throw new Error(`remote helm-repo: ${op} is read-only from the dashboard`);
  };

  return {
    async findProjectBySlug(slug) {
      const p = await getOptional<Project>(`/v1/projects/${slug}`);
      if (p) cache.remember(p);
      return p;
    },
    async findAllProjects() {
      const r = await get<{ projects: Project[] }>("/v1/projects");
      for (const p of r.projects) cache.remember(p);
      return r.projects;
    },
    async insertProject(project) {
      // Remote `POST /v1/projects` takes only the user-supplied fields and the
      // server fills id/createdAt/openJoin/etc. The HelmRepo signature is
      // id-keyed (callers in local mode build the full row), so accept it but
      // only forward the bits the REST contract knows about.
      const { body } = await postJson<Project>("/v1/projects", {
        slug: project.slug,
        name: project.name,
        gitRemote: project.gitRemote ?? undefined,
        sprintLengthDays: project.sprintLengthDays,
      });
      cache.remember(body);
    },
    async insertProjectMember() {
      // Membership is provisioned server-side by POST /v1/projects (owner) and
      // POST /v1/projects/:slug/join (member). The dashboard never inserts
      // membership rows directly against a remote helm.
      writeUnsupported("insertProjectMember");
    },
    async findProjectMember(): Promise<ProjectMember | null> {
      // The REST surface doesn't expose a per-(project,user) membership lookup;
      // 403 from /join is the source of truth. Return null so callers fall back.
      return null;
    },
    async findProjectMembersByUserSub(): Promise<ProjectMember[]> { return []; },

    async findDeveloperByHandle(): Promise<Developer | null> { return null; },
    async insertDeveloper() { writeUnsupported("insertDeveloper"); },
    async touchDeveloper() { writeUnsupported("touchDeveloper"); },
    async findDevelopersByProject(projectId) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ developers: Developer[] }>(`/v1/projects/${slug}/developers`);
      return r.developers;
    },

    async findActiveSprint(projectId) {
      const slug = await resolveSlug(projectId);
      return getOptional<Sprint>(`/v1/projects/${slug}/sprints/active`);
    },
    async findSprintById(id) {
      for (const slug of cache["bySlug" as keyof SlugCache] as unknown as Map<string, Project>) {
        const s = await getOptional<Sprint>(`/v1/projects/${(slug as unknown as [string, Project])[0]}/sprints/${id}`);
        if (s) return s;
      }
      const list = await get<{ projects: Project[] }>("/v1/projects");
      for (const p of list.projects) {
        cache.remember(p);
        const s = await getOptional<Sprint>(`/v1/projects/${p.slug}/sprints/${id}`);
        if (s) return s;
      }
      return null;
    },
    async findSprintsByProject(projectId) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ sprints: Sprint[] }>(`/v1/projects/${slug}/sprints`);
      return r.sprints;
    },
    async insertSprint() { writeUnsupported("insertSprint"); },
    async updateSprint() { writeUnsupported("updateSprint"); },
    async closeActiveSprints() { writeUnsupported("closeActiveSprints"); },
    async countSprintsByProject(projectId) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ sprints: Sprint[] }>(`/v1/projects/${slug}/sprints`);
      return r.sprints.length;
    },

    async insertEpic() { writeUnsupported("insertEpic"); },
    async updateEpic() { writeUnsupported("updateEpic"); },
    async findEpicsByProject(projectId) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ epics: Epic[] }>(`/v1/projects/${slug}/epics`);
      return r.epics;
    },

    async insertStory() { writeUnsupported("insertStory"); },
    async updateStory() { writeUnsupported("updateStory"); },
    async findStoryById(id) {
      // Dashboard rarely calls this; brute-force search across projects.
      const list = await get<{ projects: Project[] }>("/v1/projects");
      for (const p of list.projects) {
        const s = await getOptional<Story>(`/v1/projects/${p.slug}/stories/${id}`);
        if (s) return s;
      }
      return null;
    },
    async findStoriesInSprint(sprintId) {
      const sprint = await this.findSprintById(sprintId);
      if (!sprint) return [];
      const slug = await resolveSlug(sprint.projectId);
      const r = await get<{ stories: Story[] }>(`/v1/projects/${slug}/sprints/${sprintId}/stories`);
      return r.stories;
    },
    async findStoriesInSprintNotDoneOrDropped(sprintId) {
      const stories = await this.findStoriesInSprint(sprintId);
      return stories.filter((s) => s.status !== "done" && s.status !== "dropped");
    },
    async rolloverIncompleteStoriesToBacklog() {
      writeUnsupported("rolloverIncompleteStoriesToBacklog");
      return 0;
    },
    async findBacklogStories(projectId, limit) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ stories: Story[] }>(`/v1/projects/${slug}/stories/backlog?limit=${limit}`);
      return r.stories;
    },
    async countStoriesInSprintByStatus(sprintId): Promise<StatusCounts> {
      const sprint = await this.findSprintById(sprintId);
      if (!sprint) return {};
      const slug = await resolveSlug(sprint.projectId);
      const r = await get<{ byStatus: StatusCounts }>(`/v1/projects/${slug}/sprints/${sprintId}/counts`);
      return r.byStatus;
    },
    async countBacklog(projectId) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ count: number }>(`/v1/projects/${slug}/stories/backlog?limit=100000`);
      return r.count;
    },
    async countDoneStoriesInSprint(sprintId) {
      const stories = await this.findStoriesInSprint(sprintId);
      return stories.filter((s) => s.status === "done").length;
    },

    async insertTask() { writeUnsupported("insertTask"); },
    async updateTask() { writeUnsupported("updateTask"); },

    async insertDebt() { writeUnsupported("insertDebt"); },
    async closeDebt() { writeUnsupported("closeDebt"); },
    async findOpenDebtByProject(projectId, limit) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ debt: TechDebt[] }>(`/v1/projects/${slug}/debt?limit=${limit}`);
      return r.debt;
    },
    async findAllDebtByProject(projectId, limit) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ debt: TechDebt[] }>(`/v1/projects/${slug}/debt?all=1&limit=${limit}`);
      return r.debt;
    },
    async findOpenDebtAtLocation() { return null; },
    async countOpenDebtByProject(projectId) {
      const list = await this.findOpenDebtByProject(projectId, 100_000);
      return list.length;
    },

    async insertDecision() { writeUnsupported("insertDecision"); },
    async findDecisionsByProject(projectId, limit) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ decisions: Decision[] }>(`/v1/projects/${slug}/decisions?limit=${limit}`);
      return r.decisions;
    },

    async emitEvent() { writeUnsupported("emitEvent"); },
    async findRecentEvents(projectId, limit) {
      const slug = await resolveSlug(projectId);
      const r = await get<{ events: ProgressEvent[] }>(`/v1/projects/${slug}/events?limit=${limit}`);
      return r.events;
    },
    async findEventsForSprint(sprintId, limit) {
      const sprint = await this.findSprintById(sprintId);
      if (!sprint) return [];
      const slug = await resolveSlug(sprint.projectId);
      const r = await get<{ events: ProgressEvent[] }>(
        `/v1/projects/${slug}/sprints/${sprintId}/events?limit=${limit}`,
      );
      return r.events;
    },
    async countEventsByKindInSprint(sprintId, kind) {
      const sprint = await this.findSprintById(sprintId);
      if (!sprint) return 0;
      const slug = await resolveSlug(sprint.projectId);
      const r = await get<{ debtOpened: number; debtClosed: number; byStatus: StatusCounts }>(
        `/v1/projects/${slug}/sprints/${sprintId}/counts`,
      );
      if (kind === "debt.opened") return r.debtOpened;
      if (kind === "debt.closed") return r.debtClosed;
      // Fallback: scan event log.
      const events = await this.findEventsForSprint(sprintId, 100_000);
      return events.filter((e) => e.kind === kind).length;
    },
    async findEventsByDeveloper(projectId, developerId, limit) {
      // Filter from project events; dashboard doesn't use this often.
      const events = await this.findRecentEvents(projectId, limit * 10);
      return events.filter((e) => e.developerId === developerId).slice(0, limit);
    },

    async joinProject(slug: string): Promise<JoinResult> {
      const { status, body } = await postJson<{ slug: string; role: "owner" | "member"; alreadyMember: boolean }>(
        `/v1/projects/${slug}/join`,
        {},
      );
      // Server returns 200 for already-member, 201 for fresh; trust the body
      // but defensively re-derive `alreadyMember` from status if missing.
      return {
        slug: body.slug ?? slug,
        role: body.role ?? "member",
        alreadyMember: body.alreadyMember ?? status === 200,
      };
    },
  } satisfies RemoteHelmRepo;
}
