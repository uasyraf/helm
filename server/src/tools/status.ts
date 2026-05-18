import type { ToolRegistrar } from "./types.js";
import { jsonResult } from "./types.js";

export const registerStatusTools: ToolRegistrar = (server, ctx) => {
  server.registerTool(
    "get_status",
    {
      title: "Project status",
      description: "Active sprint, in-flight stories, open debt counts, killer metric (debt delta this sprint).",
      inputSchema: {},
    },
    async () => {
      const { repo, session } = ctx;
      const sprintId = session.activeSprint.id;
      const projectId = session.project.id;

      const inSprintByStatus = await repo.countStoriesInSprintByStatus(sprintId);
      const backlogCount = await repo.countBacklog(projectId);
      const openDebt = await repo.countOpenDebtByProject(projectId);
      const opened = await repo.countEventsByKindInSprint(sprintId, "debt.opened");
      const closed = await repo.countEventsByKindInSprint(sprintId, "debt.closed");

      return jsonResult({
        project: { slug: session.project.slug, name: session.project.name },
        sprint: {
          id: session.activeSprint.id,
          name: session.activeSprint.name,
          goal: session.activeSprint.goal,
          startedAt: session.activeSprint.startedAt,
          status: session.activeSprint.status,
        },
        stories: { inSprintByStatus, backlogCount },
        debt: { open: openDebt, openedThisSprint: opened, closedThisSprint: closed, delta: opened - closed },
        warnings: session.warnings,
      });
    },
  );
};
